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
//   - 미국 ISM PMI(제조업·서비스업): DBnomics(무인증)  ISM/pmi/pm, ISM/nm-pmi/pm
//     ⚠️ FRED는 ISM 시리즈를 2016년에 전량 삭제(ISM 재배포 권한 회수)했다 → DBnomics 사용.
//
// 정규화 스키마 (public/data/macro/macro.json):
//   { collectedAt, indicators: [ { key,label,unit,decimals,source, threshold?,
//       series: [ { name, points: [ {date:'YYYY-MM-DD', value:number} ] } ] } ] }
//   threshold(선택): { value:number, belowIsBad:boolean, label:string } — 기준선·침체 신호용.

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

// Yahoo Finance chart 응답 → 오름차순 포인트(일별 종가). null 종가/주말 미체결은 제외.
export function parseYahooChart(json) {
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp;
  const closes = r?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(ts) || !Array.isArray(closes)) {
    if (json?.chart?.error) throw new Error(`Yahoo 오류: ${json.chart.error?.description ?? ''}`);
    throw new Error('Yahoo 응답 형식 오류');
  }
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const v = num(closes[i]);
    if (!isNum(ts[i]) || v === null) continue;
    out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), value: v });
  }
  return out;
}

// Yahoo Finance chart 응답 → 오름차순 OHLC 포인트(봉차트용). null 바(주말·미체결)는 제외.
// value=close(스파크라인·라인 호환). open/high/low/close 모두 있어야 채택.
export function parseYahooOHLC(json) {
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp;
  const q = r?.indicators?.quote?.[0];
  if (!Array.isArray(ts) || !q) {
    if (json?.chart?.error) throw new Error(`Yahoo 오류: ${json.chart.error?.description ?? ''}`);
    throw new Error('Yahoo 응답 형식 오류');
  }
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const o = num(q.open?.[i]);
    const h = num(q.high?.[i]);
    const l = num(q.low?.[i]);
    const c = num(q.close?.[i]);
    if (!isNum(ts[i]) || o === null || h === null || l === null || c === null) continue;
    out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), value: c, open: o, high: h, low: l, close: c });
  }
  return out;
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

// DBnomics 시리즈 응답 → 오름차순 포인트. series.docs[0]의 병렬 배열
// (period_start_day|period, value)을 짝짓는다. 결측('NA'/null/비숫자)은 제외.
export function parseDbnomicsSeries(json) {
  const doc = json?.series?.docs?.[0];
  if (!doc) throw new Error('DBnomics 응답 형식 오류');
  const days = Array.isArray(doc.period_start_day) ? doc.period_start_day : null;
  const periods = Array.isArray(doc.period) ? doc.period : null;
  const values = Array.isArray(doc.value) ? doc.value : null;
  if (!values || (!days && !periods)) throw new Error('DBnomics 응답 형식 오류');
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const v = num(values[i]);
    if (v === null) continue; // 'NA'·null·결측 제외
    const raw = days?.[i] ?? (periods?.[i] ? `${periods[i]}-01` : null);
    const date = String(raw ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({ date, value: v });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// --- 정규화/병합 (테스트 대상) ---

// 포인트 배열 정리: 유효값만, 날짜 오름차순, 최대 maxPoints개(뒤에서).
// OHLC(open/high/low/close)가 모두 있으면 보존(봉차트용), 없으면 {date,value}만.
export function cleanPoints(points, maxPoints = 60) {
  const arr = (points ?? [])
    .map((p) => {
      const date = String(p?.date ?? '');
      let value = num(p?.value);
      const o = num(p?.open), h = num(p?.high), l = num(p?.low), c = num(p?.close);
      const point = { date, value };
      if (o !== null && h !== null && l !== null && c !== null) {
        point.open = o; point.high = h; point.low = l; point.close = c;
        if (point.value === null) point.value = c; // value 누락 시 종가로 보정
      }
      return point;
    })
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && isNum(p.value))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return maxPoints > 0 ? arr.slice(-maxPoints) : arr;
}

// 포인트 누적 병합: 이전 ∪ 신규(같은 날짜는 신규가 덮어씀), 오름차순, 최대 maxPoints개.
// 소스가 롤링 윈도우(예: FRED 3년)만 줘도 매 수집마다 합쳐 히스토리를 쌓기 위함.
export function mergePoints(prev, next, maxPoints = 0) {
  const byDate = new Map();
  for (const p of prev ?? []) if (p && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) byDate.set(p.date, p);
  for (const p of next ?? []) if (p && /^\d{4}-\d{2}-\d{2}$/.test(p.date)) byDate.set(p.date, p);
  const arr = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return maxPoints > 0 ? arr.slice(-maxPoints) : arr;
}

// 임계값 메타 정규화. value가 숫자일 때만 객체 반환, 아니면 null(필드 미포함).
// 방향: aboveIsBad(높을수록 위험, 예: 신용스프레드) 또는 belowIsBad(낮을수록 위험, 예: ISM).
// 방향 미지정 시 기본은 belowIsBad(하위가 나쁨). 둘 다 켤 수도 있음(밴드).
function normalizeThreshold(t) {
  const value = num(t?.value);
  if (value === null) return null;
  const aboveIsBad = t?.aboveIsBad === true;
  const belowIsBad = aboveIsBad ? t?.belowIsBad === true : t?.belowIsBad !== false;
  const out = { value, label: String(t?.label ?? '') };
  if (belowIsBad) out.belowIsBad = true;
  if (aboveIsBad) out.aboveIsBad = true;
  return out;
}

// 지표 1개 정규화. series 각각 cleanPoints 적용. threshold는 있을 때만 보존.
export function normalizeIndicator(ind) {
  const out = {
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
  const threshold = normalizeThreshold(ind?.threshold);
  if (threshold) out.threshold = threshold;
  if (ind?.category) out.category = String(ind.category); // 탭 분류(예: 'crisis'). 없으면 기본 탭.
  return out;
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

// Stooq: 일별 종가 시계열. ⚠️ 2026년 현재 Stooq는 JS 봇차단(PoW)이 걸려 서버/CI에서 실패함 → Yahoo 사용.
export async function fetchStooqSeries(symbol) {
  return parseStooqCsv(await fetchText(`https://stooq.com/q/d/l/?s=${symbol}&i=d`));
}

// Yahoo Finance: 일별 종가 시계열(무인증). 예: 'DX-Y.NYB'(ICE 달러인덱스).
export async function fetchYahooSeries(symbol, { range = '6mo', interval = '1d' } = {}) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  return parseYahooChart(await fetchJson(url));
}

// Yahoo Finance: 일별 OHLC 시계열(봉차트용). 주봉·월봉·연봉은 프런트가 일봉을 집계해 만든다.
export async function fetchYahooOHLC(symbol, { range = '2y', interval = '1d' } = {}) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  return parseYahooOHLC(await fetchJson(url));
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

// DBnomics StatisticSearch: provider/dataset/series 한 시리즈의 관측치(무인증, 오름차순).
// 예: ('ISM','pmi','pm') → 미국 ISM 제조업 PMI(월별).
export async function fetchDbnomicsSeries(provider, dataset, series) {
  const url = `https://api.db.nomics.world/v22/series/` +
    `${encodeURIComponent(provider)}/${encodeURIComponent(dataset)}/${encodeURIComponent(series)}` +
    `?observations=1&format=json`;
  return parseDbnomicsSeries(await fetchJson(url));
}
