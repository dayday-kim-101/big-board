const UA = 'Mozilla/5.0 (compatible; stock-bigboard/0.1)';
const INDEX_CODES = ['KOSPI', 'KOSDAQ', 'KPI200'];
const INDEX_LABELS = { KOSPI: 'KOSPI', KOSDAQ: 'KOSDAQ', KPI200: 'KOSPI200' };
const MARKETS = [
  { key: 'KOSPI', label: '코스피', sosok: '01', stockCategory: 'KOSPI' },
  { key: 'KOSDAQ', label: '코스닥', sosok: '02', stockCategory: 'KOSDAQ' },
];

export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').replace(/[+\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function signedNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(/,/g, '').trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function wonFromEok(v) {
  const n = signedNum(v);
  return n == null ? null : Math.round(n * 100_000_000);
}

function wonFromMillion(v) {
  const n = num(v);
  return n == null ? null : Math.round(n * 1_000_000);
}

export function parseIndexRow(code, row = {}) {
  const close = row.closePrice ?? row.closePriceRaw;
  const change = row.compareToPreviousClosePrice ?? row.compareToPreviousClosePriceRaw;
  const ratio = row.fluctuationsRatio ?? row.fluctuationsRatioRaw;
  const direction = row.compareToPreviousPrice?.name || (signedNum(change) > 0 ? 'RISING' : signedNum(change) < 0 ? 'FALLING' : 'UNCHANGED');
  return {
    code,
    name: INDEX_LABELS[code] || code,
    date: String(row.localTradedAt || '').slice(0, 10),
    closePrice: num(close),
    change: signedNum(change),
    changePct: signedNum(ratio),
    direction,
    marketStatus: row.marketStatus || '',
    raw: row,
  };
}

export function summarizeBreadth(rows = [], marketKey = '') {
  let up = 0; let down = 0; let flat = 0;
  for (const r of rows) {
    const name = r.compareToPreviousPrice?.name;
    const pct = signedNum(r.fluctuationsRatio);
    if (name === 'RISING' || pct > 0) up += 1;
    else if (name === 'FALLING' || pct < 0) down += 1;
    else flat += 1;
  }
  return { market: marketKey, upCount: up, downCount: down, flatCount: flat, stockCount: up + down + flat };
}

export function parseInvestorTrendHtml(html, expectedDate = '') {
  const rows = [...String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map((m) => stripHtml(m[1]));
    if (cells.length >= 4 && /^\d{2}\.\d{2}\.\d{2}$/.test(cells[0])) {
      const date = `20${cells[0].slice(0, 2)}-${cells[0].slice(3, 5)}-${cells[0].slice(6, 8)}`;
      if (expectedDate && date !== expectedDate) continue;
      return {
        date,
        personal: wonFromEok(cells[1]),
        foreign: wonFromEok(cells[2]),
        institution: wonFromEok(cells[3]),
      };
    }
  }
  return { date: expectedDate, personal: null, foreign: null, institution: null };
}

export function parseForeignerTopHtml(html, marketKey = '') {
  const out = [];
  const rows = [...String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  for (const row of rows) {
    const code = /code=(\d+)/.exec(row)?.[1];
    if (!code) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripHtml(m[1])).filter(Boolean);
    // 종목명, 수량(주), 금액(백만원), 당일거래량
    if (cells.length >= 4 && !/^(KODEX|TIGER|KBSTAR|ACE|SOL|HANARO|ARIRANG|PLUS|KOSEF|히어로즈|RISE)\b/i.test(cells[0])) {
      out.push({ market: marketKey, code, name: cells[0], quantity: num(cells[1]), netBuyAmount: wonFromMillion(cells[2]), tradingVolume: num(cells[3]) });
    }
    if (out.length >= 3) break;
  }
  return out;
}

export function buildReport({ date, indices = [], breadth = [], investor = [], foreignerTop = [], collectedAt = new Date().toISOString(), source = 'naver' } = {}) {
  const byMarket = Object.fromEntries(MARKETS.map((m) => [m.key, { ...m, breadth: null, investor: null }]));
  for (const b of breadth) if (byMarket[b.market]) byMarket[b.market].breadth = b;
  for (const i of investor) if (byMarket[i.market]) byMarket[i.market].investor = i;
  return sanitizeReport({ date, collectedAt, source, indices, markets: Object.values(byMarket), foreignerTop, memo: '' });
}

export function sanitizeReport(input = {}) {
  return {
    date: String(input.date || '').slice(0, 10),
    collectedAt: String(input.collectedAt || ''),
    source: String(input.source || 'naver'),
    memo: String(input.memo || '').slice(0, 1000),
    indices: Array.isArray(input.indices) ? input.indices.slice(0, 5).map((x) => ({
      code: String(x.code || ''), name: String(x.name || x.code || ''), date: String(x.date || '').slice(0, 10),
      closePrice: num(x.closePrice), change: signedNum(x.change), changePct: signedNum(x.changePct), direction: String(x.direction || ''), marketStatus: String(x.marketStatus || ''),
    })) : [],
    markets: Array.isArray(input.markets) ? input.markets.slice(0, 4).map((m) => ({
      key: String(m.key || ''), label: String(m.label || ''), sosok: String(m.sosok || ''),
      breadth: m.breadth ? { market: String(m.breadth.market || ''), upCount: num(m.breadth.upCount) || 0, downCount: num(m.breadth.downCount) || 0, flatCount: num(m.breadth.flatCount) || 0, stockCount: num(m.breadth.stockCount) || 0 } : null,
      investor: m.investor ? { market: String(m.investor.market || ''), date: String(m.investor.date || '').slice(0, 10), personal: signedNum(m.investor.personal), foreign: signedNum(m.investor.foreign), institution: signedNum(m.investor.institution) } : null,
    })) : [],
    foreignerTop: Array.isArray(input.foreignerTop) ? input.foreignerTop.slice(0, 6).map((x) => ({
      market: String(x.market || ''), code: String(x.code || ''), name: String(x.name || ''), quantity: num(x.quantity), netBuyAmount: signedNum(x.netBuyAmount), tradingVolume: num(x.tradingVolume),
    })) : [],
  };
}

export function applyMemo(report, memo) {
  return sanitizeReport({ ...report, memo });
}

function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://m.stock.naver.com/' } });
  if (!res.ok) throw new Error(`Naver JSON ${res.status}: ${url}`);
  return res.json();
}

async function fetchEucKr(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*', Referer: 'https://finance.naver.com/' } });
  if (!res.ok) throw new Error(`Naver finance ${res.status}: ${url}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder('euc-kr').decode(buf);
}

async function fetchIndexRows() {
  try {
    const data = await fetchJson(`https://polling.finance.naver.com/api/realtime/domestic/index/${INDEX_CODES.join(',')}`);
    const byCode = new Map((data?.datas || []).map((row) => [row.itemCode || row.symbolCode, row]));
    const rows = INDEX_CODES.map((code) => parseIndexRow(code, byCode.get(code) || {}));
    if (rows.every((r) => r.date && r.closePrice != null)) return rows;
  } catch {
    // polling API 실패 시 price API로 폴백. 단, price API는 marketStatus가 없어 UI에 확정 상태를 표시하지 못한다.
  }
  return Promise.all(INDEX_CODES.map(async (code) => {
    const rows = await fetchJson(`https://m.stock.naver.com/api/index/${code}/price?pageSize=1&page=1`);
    return parseIndexRow(code, rows?.[0] || {});
  }));
}

export async function fetchKoreaMarketReport({ date = '' } = {}) {
  const indexRows = await fetchIndexRows();
  const reportDate = date || indexRows.find((x) => x.date)?.date || '';
  const marketPayloads = await Promise.all(MARKETS.map(async (m) => {
    const first = await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/${m.stockCategory}?page=1&pageSize=100`);
    const pages = Math.max(1, Math.ceil((num(first.totalCount) || first.stocks?.length || 0) / 100));
    let stocks = Array.isArray(first.stocks) ? first.stocks : [];
    for (let p = 2; p <= pages; p += 1) {
      const j = await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/${m.stockCategory}?page=${p}&pageSize=100`);
      stocks = stocks.concat(j.stocks || []);
    }
    stocks = stocks.filter((x) => x.stockEndType === 'stock');
    return { market: m, stocks };
  }));
  const breadth = marketPayloads.map(({ market, stocks }) => summarizeBreadth(stocks, market.key));
  const investor = await Promise.all(MARKETS.map(async (m) => {
    const html = await fetchEucKr(`https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=${reportDate.replace(/-/g, '')}&sosok=${m.sosok}`);
    return { market: m.key, ...parseInvestorTrendHtml(html, reportDate) };
  }));
  const foreignerTop = (await Promise.all(MARKETS.map(async (m) => {
    const html = await fetchEucKr(`https://finance.naver.com/sise/sise_deal_rank_iframe.naver?sosok=${m.sosok}&investor_gubun=9000&type=buy`);
    return parseForeignerTopHtml(html, m.key);
  }))).flat().sort((a, b) => (b.netBuyAmount || 0) - (a.netBuyAmount || 0)).slice(0, 3);
  return buildReport({ date: reportDate, indices: indexRows, breadth, investor, foreignerTop });
}
