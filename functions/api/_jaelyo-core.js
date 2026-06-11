// 재료정리 수집 코어 — 일별 수집 스크립트(scripts/jaelyo-snapshot.mjs)와
// 보드 Function(functions/api/jaelyo.js)이 공유한다.
// 파일명이 '_'로 시작하므로 Pages Functions 라우트로 노출되지 않는다.
//
// 순수 파서/계산/병합은 네트워크 비의존(테스트 대상)이고,
// issueToken/fetch* 래퍼는 얇은 네트워크 경계다(테스트 미대상).
//
// 정규화 스키마 (data/jaelyo/YYYY-MM-DD.json 의 rows[]):
//   { rank, prevRank, code, name, price, changePct,
//     marketCap(원), tradingValue(원), tvToMcapPct, manual{...} }
//
// ⚠ 키움 REST 계약(도메인·api-id·필드명·단위)은 공식 문서/실호출로 검증 후 확정할 것.
//   현재 필드명은 문서 기준 best-effort이며 파서에 격리되어 있어 한 곳만 고치면 된다.

// --- 단위 환산 상수 ---
const WON_PER_MILLION = 1_000_000; // 키움 거래대금: 백만원 → 원
const WON_PER_EOK = 100_000_000; //   키움 시가총액: 억원 → 원

// 사용자 수동 입력 7개 항목 (신규/기존 ~ 수급)
export const MANUAL_FIELDS = [
  'newOrExisting', // 신규/기존
  'theme', // 테마
  'material', // 재료
  'materialPersistence', // 재료지속성
  'materialContinuity', // 재료연속여부
  'financials', // 재무
  'supplyDemand', // 수급
];

// --- 숫자 유틸 ---
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}
function absNum(v) {
  const n = num(v);
  return n === null ? null : Math.abs(n);
}
function scale(n, factor) {
  return n === null ? null : Math.round(n * factor);
}
function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// --- 순수 파서/계산/병합 (테스트 대상) ---

// 거래대금상위(ka10032) 응답 → [{rank, code, name, price, changePct, tradingValue(원)}]
export function parseRanking(json) {
  const arr = json?.trde_prica_upper;
  if (!Array.isArray(arr)) throw new Error('거래대금상위 응답 형식 오류');
  return arr
    .map((o, i) => ({
      rank: num(o.rank) ?? i + 1, // 응답에 순위 없으면 배열 순서
      code: String(o.stk_cd ?? '').trim(),
      name: String(o.stk_nm ?? '').trim(),
      price: absNum(o.cur_prc), // 현재가(부호는 등락방향이므로 절대값)
      changePct: num(o.flu_rt),
      tradingValue: scale(num(o.trde_prica), WON_PER_MILLION),
    }))
    .filter((r) => r.code);
}

// 주식기본정보(ka10001) 응답 → 시가총액(원). 누락 시 null.
export function parseBasicInfo(json) {
  return scale(num(json?.mac), WON_PER_EOK);
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
      if (input[k] !== null && input[k] !== undefined) out[k] = String(input[k]).trim();
    }
  }
  return out;
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
export function normalizeBoard({ date, rows = [], collectedAt = null, source = 'kiwoom' }) {
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

const baseUrl = (env) => (env && env.KIWOOM_API_BASE) || 'https://api.kiwoom.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// OAuth access token 발급.
export async function issueToken(env) {
  const res = await fetch(`${baseUrl(env)}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: env.KIWOOM_APPKEY,
      secretkey: env.KIWOOM_SECRETKEY,
    }),
  });
  if (!res.ok) throw new Error(`키움 토큰 발급 실패 HTTP ${res.status}`);
  const j = await res.json();
  if (!j || !j.token) throw new Error(`키움 토큰 응답 이상: ${j?.return_msg || ''}`);
  return j.token;
}

async function kiwoomCall(env, token, { path, apiId, body, contYn = 'N', nextKey = '' }) {
  const res = await fetch(`${baseUrl(env)}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      authorization: `Bearer ${token}`,
      'api-id': apiId,
      'cont-yn': contYn,
      'next-key': nextKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`키움 ${apiId} 실패 HTTP ${res.status}`);
  return res.json();
}

// 거래대금상위 100 (ka10032). marketType: 000=전체,001=코스피,101=코스닥.
export async function fetchTopTradingValue(env, token, { marketType = '000', limit = 100 } = {}) {
  const json = await kiwoomCall(env, token, {
    path: '/api/dostk/rkinfo',
    apiId: 'ka10032',
    body: { mrkt_tp: marketType, mang_stk_incls: '1', stex_tp: '3' },
  });
  return parseRanking(json).slice(0, limit);
}

// 종목 시가총액 1건 (ka10001).
export async function fetchMarketCap(env, token, code) {
  const json = await kiwoomCall(env, token, {
    path: '/api/dostk/stkinfo',
    apiId: 'ka10001',
    body: { stk_cd: code },
  });
  return parseBasicInfo(json);
}

// 상위 행들에 시총 보강(스로틀) + 비율 계산. 종목별 실패는 null 허용(부분 실패).
export async function enrichMarketCaps(env, token, rows, { perSecond = 5 } = {}) {
  const gap = Math.ceil(1000 / Math.max(1, perSecond));
  const out = [];
  for (const r of rows) {
    let marketCap = null;
    try {
      marketCap = await fetchMarketCap(env, token, r.code);
    } catch {
      marketCap = null; // 부분 실패 허용
    }
    out.push({ ...r, marketCap, tvToMcapPct: computeTvToMcapPct(r.tradingValue, marketCap) });
    await sleep(gap);
  }
  return out;
}
