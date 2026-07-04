// 재료정리 수집 코어 — 일별 수집 스크립트(scripts/jaelyo-snapshot.mjs)와
// 보드 Function(functions/api/jaelyo.js)이 공유한다.
// 파일명이 '_'로 시작하므로 Pages Functions 라우트로 노출되지 않는다.
//
// 순수 파서/계산/병합은 네트워크 비의존(테스트 대상)이고,
// fetch* 래퍼는 얇은 네트워크 경계다(테스트 미대상).
//
// 데이터 소스: 네이버 모바일 API(m.stock.naver.com) — 무인증·무IP제한.
// 종목별 거래대금(accumulatedTradingValue)·시총(marketValue)이 백만원 단위로 들어있어,
// 전 종목을 받아 거래대금 내림차순 상위 100을 직접 뽑는다(소형 고거래대금주 누락 방지).
// 당일 데이터만 제공하므로 과거 일자 소급은 불가(거래일자는 응답 localTradedAt에서 읽는다).
//
// 정규화 스키마 (data/jaelyo/YYYY-MM-DD.json 의 rows[]):
//   { rank, prevRank, code, name, price, changePct,
//     marketCap(원), tradingValue(원), tvToMcapPct, manual{...} }

// 사용자 수동 입력 항목 (신규/기존 ~ 수급) + 자유 메모(notes).
// 앞 7개는 표의 구조화 열, 마지막 notes는 종목코드 팝업에서 편집하는 여러 줄 자유 메모.
export const MANUAL_FIELDS = [
  'newOrExisting', // 신규/기존
  'theme', // 테마
  'material', // 재료
  'materialPersistence', // 재료지속성
  'materialContinuity', // 재료연속여부
  'financials', // 재무
  'supplyDemand', // 수급
  'notes', // 자유 메모(여러 줄, 팝업 전용) — 레거시 memo와 호환
];

// 자유 메모(notes) 최대 길이(문자). 과도한 저장 방지.
export const NOTES_MAX_LEN = 4000;

// 네이버 단위(응답의 한글 라벨로 확인): 거래대금(accumulatedTradingValue)=백만원, 시총(marketValue)=억원.
const WON_PER_MILLION = 1_000_000; // 거래대금 백만원 → 원
const WON_PER_EOK = 100_000_000; //   시가총액 억원 → 원

// --- 숫자 유틸 ---
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}
function scale(n, factor) {
  return n === null ? null : Math.round(n * factor);
}
function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// --- 순수 파서/계산/병합 (테스트 대상) ---

// 네이버 모바일 시세 응답(한 페이지) → [{code, name, price, changePct, tradingValue(원), marketCap(원)}].
export function parseNaverStocks(json) {
  const arr = json?.stocks;
  if (!Array.isArray(arr)) throw new Error('네이버 시세 응답 형식 오류');
  return arr
    // 재료정리는 개별 종목(재료/테마) 대상 → ETF/ETN 제외(stockEnd: stock | etf | etn).
    .filter((o) => o?.stockEndType === 'stock')
    .map((o) => ({
      code: String(o.itemCode ?? '').trim(),
      name: String(o.stockName ?? '').trim(),
      price: num(o.closePrice),
      changePct: num(o.fluctuationsRatio),
      tradingValue: scale(num(o.accumulatedTradingValue), WON_PER_MILLION),
      marketCap: scale(num(o.marketValue), WON_PER_EOK),
    }))
    .filter((r) => r.code);
}

// 네이버 응답에서 거래 기준일(YYYY-MM-DD). 첫 종목의 localTradedAt 기준. 없으면 null.
export function naverTradedDate(json) {
  const t = json?.stocks?.[0]?.localTradedAt;
  return typeof t === 'string' && t.length >= 10 ? t.slice(0, 10) : null;
}

// 거래대금 내림차순 상위 limit개 선정 → rank(1..N)·시총대비 비율 부여.
export function rankByTradingValue(rows, limit = 100) {
  return [...(rows ?? [])]
    .filter((r) => num(r.tradingValue) !== null)
    .sort((a, b) => num(b.tradingValue) - num(a.tradingValue))
    .slice(0, limit)
    .map((r, i) => ({
      code: r.code,
      name: r.name,
      price: num(r.price),
      changePct: num(r.changePct),
      tradingValue: num(r.tradingValue),
      marketCap: num(r.marketCap),
      rank: i + 1,
      tvToMcapPct: computeTvToMcapPct(r.tradingValue, r.marketCap),
    }));
}

// 시총대비 거래대금 비율(%) = 거래대금 / 시총 × 100. 분모 0/누락 시 null.
export function computeTvToMcapPct(tradingValue, marketCap) {
  const tv = num(tradingValue);
  const mc = num(marketCap);
  if (tv === null || mc === null || mc === 0) return null;
  return round((tv / mc) * 100, 2);
}

// 직전 개장일 rows → {code: rank} 맵.
export function buildRankMap(rows) {
  const map = {};
  for (const r of rows ?? []) {
    if (r?.code != null) map[r.code] = r.rank ?? null;
  }
  return map;
}

// 각 행에 전일순위 부여. 직전 맵에 없으면 null.
export function attachPrevRank(rows, prevRankMap = {}) {
  return (rows ?? []).map((r) => ({ ...r, prevRank: prevRankMap[r.code] ?? null }));
}

// 수동 입력 정제: 허용된 7개 키만 통과, 문자열 trim. 빈 기본값으로 시작.
export function emptyManual() {
  return Object.fromEntries(MANUAL_FIELDS.map((k) => [k, '']));
}
export function sanitizeManual(input) {
  const out = emptyManual();
  if (input && typeof input === 'object') {
    for (const k of MANUAL_FIELDS) {
      if (input[k] !== null && input[k] !== undefined) out[k] = clampField(k, input[k]);
    }
    // 레거시 호환: notes가 비었고 memo가 있으면 memo를 자유 메모로 승격(덮어쓰지 않음).
    if (out.notes === '' && input.memo !== null && input.memo !== undefined) {
      out.notes = clampField('notes', input.memo);
    }
  }
  return out;
}

// 필드 값 정제: 문자열화 + 앞뒤 공백 제거. notes는 여러 줄 유지(내부 개행 보존) + 길이 제한.
function clampField(key, value) {
  const s = String(value).trim();
  return key === 'notes' && s.length > NOTES_MAX_LEN ? s.slice(0, NOTES_MAX_LEN) : s;
}

// 신규 수집행에 같은 날짜 파일의 기존 manual을 code 기준 보존(재수집 idempotent).
export function mergeManual(newRows, prevRows = []) {
  const prev = {};
  for (const r of prevRows ?? []) {
    if (r?.code != null) prev[r.code] = r.manual;
  }
  return (newRows ?? []).map((r) => ({
    ...r,
    manual: sanitizeManual(prev[r.code] ?? r.manual),
  }));
}

// 최종 스키마로 정규화 — 알 수 없는 필드 제거, manual 항상 7키 존재.
export function normalizeBoard({ date, rows = [], collectedAt = null, source = 'naver' }) {
  return {
    date,
    collectedAt,
    source,
    rows: (rows ?? []).map((r) => ({
      rank: num(r.rank),
      prevRank: num(r.prevRank),
      code: String(r.code ?? ''),
      name: String(r.name ?? ''),
      price: num(r.price),
      changePct: num(r.changePct),
      marketCap: num(r.marketCap),
      tradingValue: num(r.tradingValue),
      tvToMcapPct: num(r.tvToMcapPct),
      manual: sanitizeManual(r.manual),
    })),
  };
}

// --- 네트워크 래퍼 (얇음, 테스트 미대상) ---

const NAVER_BASE = 'https://m.stock.naver.com/api/stocks/marketValue';
const NAVER_TIMEOUT_MS = 12_000;
const UA = 'Mozilla/5.0 (compatible; stock-bigboard/0.1)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(NAVER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`네이버 시세 실패 HTTP ${res.status}`);
  return res.json();
}

// 한 시장(KOSPI|KOSDAQ) 전 종목을 페이지네이션으로 모은다.
async function fetchMarket(market, { pageSize = 100 } = {}) {
  const first = await getJson(`${NAVER_BASE}/${market}?page=1&pageSize=${pageSize}`);
  let rows = parseNaverStocks(first);
  const tradedDate = naverTradedDate(first);
  const total = num(first?.totalCount) ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  for (let p = 2; p <= pages; p++) {
    rows = rows.concat(parseNaverStocks(await getJson(`${NAVER_BASE}/${market}?page=${p}&pageSize=${pageSize}`)));
    await sleep(120); // 네이버에 과부하 주지 않도록 간격
  }
  return { rows, tradedDate };
}

// 전체 시장(KOSPI+KOSDAQ) 종목 + 거래 기준일. 거래대금 정렬은 호출부(rankByTradingValue)가 한다.
export async function fetchTopStocks({ markets = ['KOSPI', 'KOSDAQ'] } = {}) {
  let rows = [];
  let tradedDate = null;
  for (const m of markets) {
    const r = await fetchMarket(m);
    rows = rows.concat(r.rows);
    tradedDate = tradedDate || r.tradedDate;
  }
  return { rows, tradedDate };
}
