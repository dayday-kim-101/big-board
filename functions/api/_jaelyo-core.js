// 재료정리 수집 코어 — 일별 수집 스크립트(scripts/jaelyo-snapshot.mjs)와
// 보드 Function(functions/api/jaelyo.js)이 공유한다.
// 파일명이 '_'로 시작하므로 Pages Functions 라우트로 노출되지 않는다.
//
// 순수 파서/계산/병합은 네트워크 비의존(테스트 대상)이고,
// fetchAllStocks 래퍼는 얇은 네트워크 경계다(테스트 미대상).
//
// 데이터 소스: KRX(data.krx.co.kr) 전종목 시세 — 무인증·무IP제한, 일자 지정 가능.
// 한 번 호출로 종목코드·종목명·종가·등락률·거래대금(원)·시가총액(원)을 모두 얻는다.
// ⚠ KRX bld/필드명(ISU_SRT_CD·ACC_TRDVAL·MKTCAP 등)은 실응답으로 1회 검증 후 확정할 것.
//   필드 매핑이 parseAllStocks 한 곳에 격리되어 있어 변경 지점이 단일하다.
//
// 정규화 스키마 (data/jaelyo/YYYY-MM-DD.json 의 rows[]):
//   { rank, prevRank, code, name, price, changePct,
//     marketCap(원), tradingValue(원), tvToMcapPct, manual{...} }

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
function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// --- 순수 파서/계산/병합 (테스트 대상) ---

// KRX 전종목 시세(MDCSTAT01501) 응답 → [{code, name, price, changePct, tradingValue(원), marketCap(원)}].
// KRX는 거래대금·시총을 원 단위로 제공하므로 환산이 필요 없다.
export function parseAllStocks(json) {
  const arr = json?.OutBlock_1;
  if (!Array.isArray(arr)) throw new Error('KRX 전종목 시세 응답 형식 오류');
  return arr
    .map((o) => ({
      code: String(o.ISU_SRT_CD ?? '').trim(),
      name: String(o.ISU_ABBRV ?? '').trim(),
      price: num(o.TDD_CLSPRC),
      changePct: num(o.FLUC_RT),
      tradingValue: num(o.ACC_TRDVAL),
      marketCap: num(o.MKTCAP),
    }))
    .filter((r) => r.code);
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
export function normalizeBoard({ date, rows = [], collectedAt = null, source = 'krx' }) {
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

// 'YYYY-MM-DD' → KRX 일자 형식 'YYYYMMDD'.
export function toKrxDate(date) {
  return String(date || '').replace(/-/g, '');
}

// --- 네트워크 래퍼 (얇음, 테스트 미대상) ---

const KRX_URL = 'https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';
const KRX_REFERER = 'https://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd';
const KRX_TIMEOUT_MS = 15_000;
const UA = 'Mozilla/5.0 (compatible; stock-bigboard/0.1)';

// KRX 전종목 시세(MDCSTAT01501) — 무인증. 휴장일/미래일자는 빈 목록을 반환한다.
// date: 'YYYY-MM-DD'. mktId: ALL=전체, STK=코스피, KSQ=코스닥.
//
// ⚠ 실행 시점 확인: KRX getJsonData는 로더 페이지(Referer)를 먼저 방문해 받은 세션 쿠키를
//   요구할 수 있다(쿠키 없이 POST하면 JSON 대신 'LOGOUT' 등 비정상 응답이 올 수 있음).
//   그 경우 아래에서 set-cookie를 받아 Cookie 헤더로 전달하는 2단계 호출로 바꾼다.
//   첫 실호출로 필요 여부를 확정한다.
export async function fetchAllStocks(date, { url = KRX_URL, mktId = 'ALL' } = {}) {
  const body = new URLSearchParams({
    bld: 'dbms/MDC/STAT/standard/MDCSTAT01501',
    mktId,
    trdDd: toKrxDate(date),
    share: '1',
    money: '1',
    csvxls_isNo: 'false',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': UA,
      Referer: KRX_REFERER,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(KRX_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`KRX 전종목 시세 실패 HTTP ${res.status}`);
  let json;
  try {
    json = await res.json();
  } catch {
    // JSON이 아니면(예: 세션 누락 시 'LOGOUT') 명확히 실패시켜 휴장 가드와 구분한다.
    throw new Error('KRX 응답이 JSON이 아님(세션 쿠키 필요 가능성 — 위 주석 참고)');
  }
  return parseAllStocks(json);
}
