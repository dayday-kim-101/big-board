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

// --- code-level 글로벌 manual (종목별 메모 영속) ---
//
// 배경: 재료정리 메모/수동정보는 '날짜'가 아니라 '종목'에 귀속되어야 한다. 새 거래일 파일이
//       생겨도 같은 code면 기존 메모가 따라오고, 사용자가 수정한 것만 종목 정보로 갱신된다.
//       실체는 data/jaelyo/manual-by-code.json — { "005930": { ...manual 8키... }, ... }.
//
// 프로토타입 오염 방어: code 키 자체(__proto__ 등)를 map에 쓰지 않고, 값은 sanitizeManual로 정제.
function isUnsafeKey(key) {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

// 행별 manual에 code-level 글로벌 값을 빈 필드 폴백으로 채운다.
// 우선순위: row.manual의 non-empty 값 > globalByCode[code]. 사용자가 채운 값은 절대 덮지 않는다.
export function mergeRowsWithGlobalManual(rows, globalByCode = {}) {
  const g = globalByCode || {};
  return (rows ?? []).map((r) => {
    const code = String(r?.code ?? '');
    const fallback = !isUnsafeKey(code) && Object.prototype.hasOwnProperty.call(g, code) ? g[code] : null;
    return { ...r, manual: fillEmptyManual(r?.manual, fallback) };
  });
}

// base(행) manual을 기준으로 빈 필드만 fallback(글로벌)으로 채운 8키 manual 반환.
function fillEmptyManual(baseManual, fallbackManual) {
  const base = sanitizeManual(baseManual);
  const fb = sanitizeManual(fallbackManual);
  const out = { ...base };
  for (const k of MANUAL_FIELDS) {
    if (out[k] === '') out[k] = fb[k];
  }
  return out;
}

// 사용자가 수정한 patch만 code-level map에 반영한 '새' map을 반환(입력 불변).
// patch에 있는 키만 갱신되고 나머지는 기존 글로벌 값을 유지한다. 빈 문자열로도 갱신 가능
// (필드를 명시적으로 비울 수 있음). sanitizeManual로 화이트리스트·프로토타입 오염 방어 유지.
export function updateGlobalManual(globalByCode, code, patch) {
  const src = globalByCode || {};
  const next = { ...src };
  const key = String(code ?? '').trim();
  if (!key || isUnsafeKey(key)) return next;
  const existing = Object.prototype.hasOwnProperty.call(src, key) ? src[key] : {};
  next[key] = sanitizeManual({ ...sanitizeManual(existing), ...patch });
  return next;
}

// 여러 dated 보드 + 선택적 seed로 code-level 글로벌 manual map을 구성한다(순수 함수).
// 우선순위(낮음→높음): manualSeed/notesSeed < 오래된 dated 보드 < 최신 dated 보드.
//   - 필드별로 non-empty 값만 채택하고, 더 최신 날짜의 non-empty가 이전 값을 덮는다.
//   - 따라서 사용자가 수정한 최신 dated 값이 seed보다 항상 우선된다.
// seeds: { manualSeed?: {code: {구조화필드...}}, notesSeed?: {code: notes문자열} }.
export function buildGlobalManualByCodeFromBoards(boards = [], seeds = {}) {
  const manualSeed = seeds?.manualSeed || {};
  const notesSeed = seeds?.notesSeed || {};
  const acc = {}; // code -> { field: non-empty value }

  // 소스의 non-empty 필드만 누적(뒤에 오는 소스가 앞을 덮음).
  const apply = (code, manual) => {
    const key = String(code ?? '').trim();
    if (!key || isUnsafeKey(key)) return;
    const clean = sanitizeManual(manual);
    if (!Object.prototype.hasOwnProperty.call(acc, key)) acc[key] = {};
    for (const k of MANUAL_FIELDS) {
      if (clean[k] !== '') acc[key][k] = clean[k];
    }
  };

  // 1) seed (최저 우선순위)
  for (const code of Object.keys(manualSeed)) apply(code, manualSeed[code]);
  for (const code of Object.keys(notesSeed)) apply(code, { notes: notesSeed[code] });

  // 2) dated 보드 — 날짜 오름차순으로 적용해 '최신 non-empty' 우선.
  const sorted = [...(boards ?? [])].sort((a, b) => {
    const da = String(a?.date ?? '');
    const db = String(b?.date ?? '');
    return da < db ? -1 : da > db ? 1 : 0;
  });
  for (const b of sorted) {
    for (const r of b?.rows ?? []) apply(r?.code, r?.manual);
  }

  // 8키 manual로 정제해 반환.
  const out = {};
  for (const key of Object.keys(acc)) out[key] = sanitizeManual(acc[key]);
  return out;
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
