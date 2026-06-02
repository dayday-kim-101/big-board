// 종목 검색/자동완성 코어 — Pages Function과 공유.
// KR = 네이버 자동완성(한글 지원), US = Yahoo search(영문/심볼).
// 파일명이 '_'로 시작하므로 라우트로 노출되지 않는다.
//
// 결과 스키마: { market: 'KR'|'US', code, name, sub }  (sub = 거래소/시장 라벨)

const UA = 'Mozilla/5.0 (compatible; stock-bigboard/0.1)';
const NAVER_AC = (q) => `https://ac.stock.naver.com/ac?q=${encodeURIComponent(q)}&target=stock`;
const YAHOO_SEARCH = (q) =>
  `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;

// US 정규 거래소만 통과(OTC/해외 제외)
const US_EXCH = new Set(['NMS', 'NGM', 'NCM', 'NYQ', 'ASE', 'PCX', 'BATS']);

// --- 순수 파서 (네트워크 없음, 테스트 대상) ---

export function parseNaverSearch(json) {
  const items = Array.isArray(json?.items) ? json.items : [];
  const out = [];
  for (const it of items) {
    if (it?.category && it.category !== 'stock') continue;
    if (it?.nationCode && it.nationCode !== 'KOR') continue;
    const code = String(it?.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) continue; // KR 6자리 코드만
    out.push({ market: 'KR', code, name: it.name || code, sub: it.typeName || it.typeCode || 'KR' });
  }
  return out;
}

export function parseYahooSearch(json) {
  const quotes = Array.isArray(json?.quotes) ? json.quotes : [];
  const out = [];
  for (const q of quotes) {
    if (q?.quoteType !== 'EQUITY' && q?.quoteType !== 'ETF') continue;
    if (!US_EXCH.has(q?.exchange)) continue; // US 정규 거래소만
    const code = String(q?.symbol ?? '').trim();
    if (!code || code.includes('.')) continue; // 접미사(.KS/.TO 등)=해외 제외
    out.push({ market: 'US', code, name: q.shortname || q.longname || code, sub: q.exchange });
  }
  return out;
}

export function mergeResults(lists, limit = 8) {
  const seen = new Set();
  const out = [];
  for (const r of lists.flat()) {
    const key = `${r.market}:${r.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

// --- 네트워크 ---

async function getJson(url, headers) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// KR/US 동시 검색. 각 소스 실패는 무시(예: Yahoo는 한글 쿼리에 400).
export async function searchTickers(q, limit = 8) {
  const query = String(q ?? '').trim();
  if (!query) return [];
  const [kr, us] = await Promise.all([
    getJson(NAVER_AC(query), { Referer: 'https://stock.naver.com/' }).then(parseNaverSearch).catch(() => []),
    getJson(YAHOO_SEARCH(query)).then(parseYahooSearch).catch(() => []),
  ]);
  return mergeResults([kr, us], limit); // KR 우선 노출
}
