// 시세 수집 코어 — Pages Function(functions/api/quotes.js)과
// 스냅샷 스크립트(scripts/snapshot.mjs)가 공유한다.
// 파일명이 '_'로 시작하므로 Pages Functions 라우트로 노출되지 않는다.
//
// 정규화 스키마:
//   { market, code, name, price, change, changePct,
//     volume, tradingValue, approxTradingValue, ok }
// 실패 시 ok:false 와 가능한 필드 null.

const UA = 'Mozilla/5.0 (compatible; stock-bigboard/0.1)';
const NAVER_URL = (code) =>
  `https://polling.finance.naver.com/api/realtime/domestic/stock/${encodeURIComponent(code)}`;
const YAHOO_URL = (symbol) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// --- 순수 파서 (네트워크 없음, 테스트 대상) ---

// 네이버 polling 응답 → 정규화. KR 전용. 거래대금(실값) 포함.
export function parseNaverKR(json, code) {
  const o = json?.datas?.[0];
  if (!o) throw new Error(`Naver: 빈 응답 (${code})`);
  return {
    market: 'KR',
    code,
    name: o.stockName ?? code,
    price: num(o.closePriceRaw ?? o.closePrice),
    change: num(o.compareToPreviousClosePriceRaw ?? o.compareToPreviousClosePrice),
    changePct: num(o.fluctuationsRatioRaw ?? o.fluctuationsRatio),
    volume: num(o.accumulatedTradingVolumeRaw ?? o.accumulatedTradingVolume),
    tradingValue: num(o.accumulatedTradingValueRaw ?? o.accumulatedTradingValue),
    approxTradingValue: false,
    ok: true,
  };
}

// Yahoo chart 응답 → 정규화. US 및 KR 폴백. 거래대금은 가격×거래량 근사.
export function parseYahoo(json, { market, code }) {
  const m = json?.chart?.result?.[0]?.meta;
  if (!m || m.regularMarketPrice === undefined) {
    throw new Error(`Yahoo: 메타 없음 (${code})`);
  }
  const price = num(m.regularMarketPrice);
  const prev = num(m.chartPreviousClose ?? m.previousClose);
  const change = price !== null && prev !== null ? round(price - prev, 4) : null;
  const changePct =
    change !== null && prev ? round((change / prev) * 100, 2) : null;
  const volume = num(m.regularMarketVolume);
  const tradingValue =
    price !== null && volume !== null ? Math.round(price * volume) : null;
  return {
    market,
    code,
    name: m.shortName || m.longName || code,
    price,
    change,
    changePct,
    volume,
    tradingValue,
    approxTradingValue: true, // Yahoo는 실제 거래대금 미제공
    ok: true,
  };
}

function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function failed(market, code, message) {
  return {
    market,
    code,
    name: code,
    price: null,
    change: null,
    changePct: null,
    volume: null,
    tradingValue: null,
    approxTradingValue: market === 'US',
    ok: false,
    error: message,
  };
}

// --- 네트워크 페치 ---

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchKR(code) {
  // 1순위: 네이버(거래대금 포함). 실패 시 Yahoo .KS → .KQ 폴백(거래대금 근사).
  try {
    return parseNaverKR(await getJson(NAVER_URL(code)), code);
  } catch (naverErr) {
    for (const suffix of ['.KS', '.KQ']) {
      try {
        return parseYahoo(await getJson(YAHOO_URL(code + suffix)), { market: 'KR', code });
      } catch {
        /* 다음 접미사 시도 */
      }
    }
    return failed('KR', code, `Naver/Yahoo 모두 실패: ${naverErr.message}`);
  }
}

async function fetchUS(code) {
  try {
    return parseYahoo(await getJson(YAHOO_URL(code)), { market: 'US', code });
  } catch (err) {
    return failed('US', code, err.message);
  }
}

// 단일 종목 시세 (실패해도 throw하지 않고 ok:false 반환)
export async function fetchQuote({ market, code }) {
  const m = String(market || '').toUpperCase();
  if (!code) return failed(m || 'US', code, '종목 코드 없음');
  if (m === 'KR') return fetchKR(code);
  if (m === 'US') return fetchUS(code);
  return failed(m, code, `알 수 없는 시장: ${market}`);
}

// 여러 종목 — 부분 실패 허용
export async function fetchQuotes(items) {
  const list = Array.isArray(items) ? items : [];
  return Promise.all(list.map((it) => fetchQuote(it)));
}
