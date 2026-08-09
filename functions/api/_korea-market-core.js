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

function shortDate(date = '') {
  const s = String(date || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(2, 4)}.${s.slice(5, 7)}.${s.slice(8, 10)}` : '';
}

export function parseForeignerTopHtml(html, marketKey = '', expectedDate = '', side = 'buy') {
  const source = String(html || '');
  const targetShortDate = shortDate(expectedDate);
  let currentDate = '';
  const byDate = new Map();
  const undated = [];
  for (const m of source.matchAll(/(\d{2}\.\d{2}\.\d{2})|<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    if (m[1]) {
      currentDate = m[1];
      continue;
    }
    const row = m[2];
    if (!row) continue;
    const code = /code=(\d+)/.exec(row)?.[1];
    if (!code) continue;
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => stripHtml(x[1])).filter(Boolean);
    // 종목명, 수량(천주), 금액(백만원), 당일거래량
    if (cells.length < 4 || /^(KODEX|TIGER|KBSTAR|ACE|SOL|HANARO|ARIRANG|PLUS|KOSEF|히어로즈|RISE)\b/i.test(cells[0])) continue;
    const amount = wonFromMillion(cells[2]);
    const item = {
      market: marketKey,
      code,
      name: cells[0],
      quantity: num(cells[1]),
      ...(side === 'sell' ? { netSellAmount: amount } : { netBuyAmount: amount }),
      tradingVolume: num(cells[3]),
    };
    if (currentDate) {
      if (!byDate.has(currentDate)) byDate.set(currentDate, []);
      byDate.get(currentDate).push(item);
    } else {
      undated.push(item);
    }
  }
  if (targetShortDate && byDate.has(targetShortDate)) return byDate.get(targetShortDate);
  if (targetShortDate && byDate.size) return [];
  const latestDate = [...byDate.keys()].sort().at(-1);
  return latestDate ? byDate.get(latestDate) : undated;
}

export function buildReport({ date, indices = [], breadth = [], investor = [], foreignerTop = [], foreignerSellTop = [], collectedAt = new Date().toISOString(), source = 'naver' } = {}) {
  const byMarket = Object.fromEntries(MARKETS.map((m) => [m.key, { ...m, breadth: null, investor: null }]));
  for (const b of breadth) if (byMarket[b.market]) byMarket[b.market].breadth = b;
  for (const i of investor) if (byMarket[i.market]) byMarket[i.market].investor = i;
  return sanitizeReport({ date, collectedAt, source, indices, markets: Object.values(byMarket), foreignerTop, foreignerSellTop, memo: '' });
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
    foreignerTop: Array.isArray(input.foreignerTop) ? input.foreignerTop.slice(0, 10).map((x) => ({
      market: String(x.market || ''), code: String(x.code || ''), name: String(x.name || ''), quantity: num(x.quantity), netBuyAmount: signedNum(x.netBuyAmount), tradingVolume: num(x.tradingVolume),
    })) : [],
    foreignerSellTop: Array.isArray(input.foreignerSellTop) ? input.foreignerSellTop.slice(0, 10).map((x) => ({
      market: String(x.market || ''), code: String(x.code || ''), name: String(x.name || ''), quantity: num(x.quantity), netSellAmount: signedNum(x.netSellAmount), tradingVolume: num(x.tradingVolume),
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
  try {
    return new TextDecoder('euc-kr').decode(buf);
  } catch {
    // Cloudflare Workers runtimes may not expose non-UTF TextDecoder labels consistently.
    // Numeric cells are ASCII, so UTF-8 fallback still lets the report render instead of failing the whole tab.
    return new TextDecoder().decode(buf);
  }
}

async function fetchIndexRows() {
  try {
    const data = await fetchJson(`https://polling.finance.naver.com/api/realtime/domestic/index/${INDEX_CODES.join(',')}`);
    const byCode = new Map((data?.datas || []).map((row) => [row.itemCode || row.symbolCode, row]));
    const rows = INDEX_CODES.map((code) => parseIndexRow(code, byCode.get(code) || {}));
    if (rows.every((r) => r.date && r.closePrice != null && r.marketStatus === 'CLOSE')) return rows;
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
    try {
      const first = await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/${m.stockCategory}?page=1&pageSize=100`);
      const pages = Math.max(1, Math.ceil((num(first.totalCount) || first.stocks?.length || 0) / 100));
      let stocks = Array.isArray(first.stocks) ? first.stocks : [];
      for (let p = 2; p <= pages; p += 1) {
        const j = await fetchJson(`https://m.stock.naver.com/api/stocks/marketValue/${m.stockCategory}?page=${p}&pageSize=100`);
        stocks = stocks.concat(j.stocks || []);
      }
      stocks = stocks.filter((x) => x.stockEndType === 'stock');
      const firstStock = stocks[0] || {};
      const stockDate = String(firstStock.localTradedAt || '').slice(0, 10);
      const isClosedForReportDate = stockDate === reportDate && firstStock.marketStatus === 'CLOSE';
      return { market: m, stocks: isClosedForReportDate ? stocks : [], isClosedForReportDate };
    } catch {
      return { market: m, stocks: [], isClosedForReportDate: false };
    }
  }));
  const breadth = marketPayloads
    .filter(({ isClosedForReportDate }) => isClosedForReportDate)
    .map(({ market, stocks }) => summarizeBreadth(stocks, market.key));
  const investor = (await Promise.all(MARKETS.map(async (m) => {
    try {
      const html = await fetchEucKr(`https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=${reportDate.replace(/-/g, '')}&sosok=${m.sosok}`);
      return { market: m.key, ...parseInvestorTrendHtml(html, reportDate) };
    } catch {
      return { market: m.key, date: reportDate, personal: null, foreign: null, institution: null };
    }
  })));
  // 시장별 상위 3개를 각각 보존한다. 코스피 대형주가 금액으로 코스닥을 밀어내지 않게 한다.
  const [foreignerTop, foreignerSellTop] = await Promise.all(['buy', 'sell'].map(async (type) => (await Promise.all(MARKETS.map(async (m) => {
    try {
      const html = await fetchEucKr(`https://finance.naver.com/sise/sise_deal_rank_iframe.naver?sosok=${m.sosok}&investor_gubun=9000&type=${type}`);
      return parseForeignerTopHtml(html, m.key, reportDate, type).slice(0, 5);
    } catch {
      return [];
    }
  }))).flat()));
  return buildReport({ date: reportDate, indices: indexRows, breadth, investor, foreignerTop, foreignerSellTop });
}
