// 매크로 지표 수집 코어 — 일별 수집 스크립트(scripts/macro-snapshot.mjs)가 사용한다.
// 파일명이 '_'로 시작하므로 Pages Functions 라우트로 노출되지 않는다.
//
// 순수 파서/정규화는 네트워크 비의존(테스트 대상)이고, fetch* 래퍼는 얇은 경계(테스트 미대상)다.
//
// 데이터 소스(모두 공개 API):
//   - 달러인덱스: Stooq CSV (무인증)              https://stooq.com/q/d/l/?s=dx.f&i=d
//   - 미국 기준금리: FRED (API키 필요)            series_id=DFEDTARU (정책금리 상단)
//   - 한국 외환보유액·대외채무·단기외채: 한국은행 ECOS (API키 필요)
//
// 정규화 스키마 (public/data/macro/macro.json):
//   { collectedAt, indicators: [ { key,label,unit,decimals,source,
//       series: [ { name, points: [ {date:'YYYY-MM-DD', value:number} ] } ] } ] }

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

// --- 순수 파서 (테스트 대상) ---

// FRED 관측치 응답 → 오름차순 포인트. 결측('.')은 제외.
export function parseFredObservations(json) {
  const arr = json?.observations;
  if (!Array.isArray(arr)) throw new Error('FRED 응답 형식 오류');
  return arr
    .map((o) => ({ date: String(o?.date ?? ''), value: num(o?.value) }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && isNum(p.value));
}

// Stooq 일별 CSV(Date,Open,High,Low,Close,Volume) → 오름차순 포인트(Close 사용).
export function parseStooqCsv(csv) {
  const lines = String(csv ?? '').trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
  const di = header.indexOf('date');
  const ci = header.indexOf('close');
  if (di < 0 || ci < 0) return [];
  return lines
    .slice(1)
    .map((line) => {
      const cells = line.split(',');
      return { date: String(cells[di] ?? '').trim(), value: num(cells[ci]) };
    })
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && isNum(p.value));
}

// ECOS TIME 문자열 → 'YYYY-MM-DD'. 월(YYYYMM)·분기(YYYYQn/YYYYn)·연(YYYY) 지원.
export function ecosTimeToDate(time) {
  const t = String(time ?? '').trim();
  if (/^\d{6}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-01`; // 월
  const q = t.match(/^(\d{4})Q?([1-4])$/); // 분기: 2026Q1 또는 20261
  if (q) return `${q[1]}-${String(Number(q[2]) * 3).padStart(2, '0')}-01`; // 분기말 월
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`; // 일
  if (/^\d{4}$/.test(t)) return `${t}-01-01`; // 연
  return null;
}

// ECOS StatisticSearch 응답 → 오름차순 포인트. RESULT(에러)면 throw.
export function parseEcosRows(json) {
  const block = json?.StatisticSearch;
  if (json?.RESULT) throw new Error(`ECOS 오류: ${json.RESULT.CODE} ${json.RESULT.MESSAGE}`);
  if (block?.RESULT) throw new Error(`ECOS 오류: ${block.RESULT.CODE} ${block.RESULT.MESSAGE}`);
  const rows = block?.row;
  if (!Array.isArray(rows)) throw new Error('ECOS 응답 형식 오류');
  return rows
    .map((r) => ({ date: ecosTimeToDate(r?.TIME), value: num(r?.DATA_VALUE) }))
    .filter((p) => p.date && isNum(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// --- 정규화/병합 (테스트 대상) ---

// 포인트 배열 정리: 유효값만, 날짜 오름차순, 최대 maxPoints개(뒤에서).
export function cleanPoints(points, maxPoints = 60) {
  const arr = (points ?? [])
    .map((p) => ({ date: String(p?.date ?? ''), value: num(p?.value) }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && isNum(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return maxPoints > 0 ? arr.slice(-maxPoints) : arr;
}

// 지표 1개 정규화. series 각각 cleanPoints 적용.
export function normalizeIndicator(ind) {
  return {
    key: String(ind?.key ?? ''),
    label: String(ind?.label ?? ''),
    unit: String(ind?.unit ?? ''),
    decimals: isNum(ind?.decimals) ? ind.decimals : 2,
    source: String(ind?.source ?? ''),
    series: (ind?.series ?? []).map((s) => ({
      name: String(s?.name ?? ''),
      points: cleanPoints(s?.points),
    })),
  };
}

export function normalizeMacro({ collectedAt = null, seed = false, indicators = [] }) {
  const out = { collectedAt, indicators: (indicators ?? []).map(normalizeIndicator) };
  if (seed) out.seed = true;
  return out;
}

// 지표에 실제 포인트가 하나라도 있나(수집 성공 판정).
export function hasData(ind) {
  return (ind?.series ?? []).some((s) => (s?.points ?? []).length > 0);
}

// --- 네트워크 래퍼 (얇음, 테스트 미대상) ---

const TIMEOUT_MS = 15_000;
const UA = 'Mozilla/5.0 (compatible; stock-bigboard/0.1)';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
  return res.text();
}
async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
  return res.json();
}

// FRED: 최근 limit개 관측치(오름차순 반환).
export async function fetchFredSeries(seriesId, apiKey, { limit = 60 } = {}) {
  if (!apiKey) throw new Error('FRED_API_KEY 미설정');
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}` +
    `&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  return parseFredObservations(await fetchJson(url)).sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Stooq: 일별 종가 시계열.
export async function fetchStooqSeries(symbol) {
  return parseStooqCsv(await fetchText(`https://stooq.com/q/d/l/?s=${symbol}&i=d`));
}

// ECOS StatisticSearch: 통계표코드/주기/항목코드 기준 시계열.
// cycle: 'D'|'M'|'Q'|'A'. start/end는 주기 포맷(월=YYYYMM, 분기=YYYYQn, 연=YYYY).
export async function fetchEcosSeries(apiKey, { statCode, cycle, itemCode, start, end, count = 100 }) {
  if (!apiKey) throw new Error('ECOS_API_KEY 미설정');
  const seg = [
    'https://ecos.bok.or.kr/api/StatisticSearch',
    apiKey, 'json', 'kr', '1', String(count), statCode, cycle, start, end,
  ];
  if (itemCode) seg.push(itemCode);
  return parseEcosRows(await fetchJson(seg.join('/')));
}
