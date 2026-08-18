const UA = 'Mozilla/5.0 (compatible; stock-bigboard/0.1)';

export const US_INDICES = [
  { key: 'dow', label: '다우존스', symbol: '^DJI' },
  { key: 'sp500', label: 'S&P 500', symbol: '^GSPC' },
  { key: 'nasdaq', label: '나스닥', symbol: '^IXIC' },
  { key: 'russell2000', label: '러셀2000', symbol: '^RUT' },
];

export const US_FOCUS = [
  { key: 'nvidia', label: 'NVIDIA', symbol: 'NVDA' },
  { key: 'sox', label: '필라델피아 반도체지수', symbol: '^SOX' },
];

export const US_RATES = [
  { key: 'us10y', label: '미국 10년물 금리', symbol: '^TNX', unit: '%', decimals: 3 },
];

export const US_SECTORS = [
  { key: 'technology', label: '기술', symbol: 'XLK' },
  { key: 'communication', label: '커뮤니케이션', symbol: 'XLC' },
  { key: 'consumerDiscretionary', label: '경기소비재', symbol: 'XLY' },
  { key: 'consumerStaples', label: '필수소비재', symbol: 'XLP' },
  { key: 'energy', label: '에너지', symbol: 'XLE' },
  { key: 'financials', label: '금융', symbol: 'XLF' },
  { key: 'healthcare', label: '헬스케어', symbol: 'XLV' },
  { key: 'industrials', label: '산업재', symbol: 'XLI' },
  { key: 'materials', label: '소재', symbol: 'XLB' },
  { key: 'realEstate', label: '부동산', symbol: 'XLRE' },
  { key: 'utilities', label: '유틸리티', symbol: 'XLU' },
];

const ALL_ITEMS = [...US_INDICES, ...US_FOCUS, ...US_RATES, ...US_SECTORS];

export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

export function pctChange(close, prevClose) {
  const c = num(close); const p = num(prevClose);
  if (c == null || p == null || p === 0) return null;
  return ((c - p) / p) * 100;
}

function dateFromTs(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function toUnix(date, addDays = 0) {
  return Math.floor((new Date(`${date}T00:00:00Z`).getTime() + addDays * 86400_000) / 1000);
}

export function normalizeYahooSeries(symbol, payload = {}) {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const rows = timestamps.map((ts, i) => ({
    date: dateFromTs(ts),
    symbol,
    close: num(quote.close?.[i]),
    open: num(quote.open?.[i]),
    high: num(quote.high?.[i]),
    low: num(quote.low?.[i]),
    volume: num(quote.volume?.[i]),
  })).filter((r) => r.date && r.close != null);
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows.map((row, i) => {
    const prev = rows[i - 1]?.close ?? null;
    return { ...row, prevClose: prev, change: prev == null ? null : row.close - prev, changePct: pctChange(row.close, prev) };
  });
}

export function pickOnOrBefore(rows = [], date = '') {
  let picked = null;
  for (const row of rows) {
    if (row.date <= date) picked = row;
    else break;
  }
  return picked;
}

function sanitizeMarketItem(x = {}, cfg = {}) {
  return {
    key: String(cfg.key || x.key || ''),
    label: String(cfg.label || x.label || ''),
    symbol: String(cfg.symbol || x.symbol || ''),
    date: String(x.date || '').slice(0, 10),
    close: num(x.close),
    change: num(x.change),
    changePct: num(x.changePct),
    unit: String(cfg.unit || x.unit || ''),
    decimals: Number.isFinite(Number(cfg.decimals ?? x.decimals)) ? Number(cfg.decimals ?? x.decimals) : 2,
  };
}

export function generateInterpretation(report = {}) {
  const byKey = new Map([...(report.indices || []), ...(report.focus || []), ...(report.rates || [])].map((x) => [x.key, x]));
  const sp = byKey.get('sp500');
  const nq = byKey.get('nasdaq');
  const rut = byKey.get('russell2000');
  const nvda = byKey.get('nvidia');
  const sox = byKey.get('sox');
  const y10 = byKey.get('us10y');
  const leaders = (report.sectors?.rising || []).slice(0, 2).map((s) => s.label).join('·') || '주도 섹터 부재';
  const laggards = (report.sectors?.falling || []).slice(0, 2).map((s) => s.label).join('·') || '뚜렷한 하락 섹터 제한';
  const pct = (x) => (Number.isFinite(Number(x?.changePct)) ? `${Number(x.changePct) >= 0 ? '+' : ''}${Number(x.changePct).toFixed(2)}%` : '—');
  const techTone = Number(nq?.changePct ?? 0) >= Number(sp?.changePct ?? 0) && Number(sox?.changePct ?? 0) >= 0 ? '기술주/반도체가 상대적으로 지수를 지지' : '기술주/반도체 탄력은 제한';
  const breadthTone = Number(rut?.changePct ?? 0) >= Number(sp?.changePct ?? 0) ? '중소형주는 상대 견조' : '중소형주는 상대 약세';
  return `S&P500 ${pct(sp)}·나스닥 ${pct(nq)}·러셀2000 ${pct(rut)}로 ${breadthTone}, NVIDIA ${pct(nvda)}·SOX ${pct(sox)} 기준 ${techTone}; 10년물 ${y10?.close != null ? Number(y10.close).toFixed(3) + '%' : '—'} 속 상승 섹터는 ${leaders}, 하락 섹터는 ${laggards}.`;
}

export function buildReportForDate({ date, seriesBySymbol = {}, collectedAt = new Date().toISOString(), source = 'yahoo' } = {}) {
  const from = (items) => items.map((cfg) => sanitizeMarketItem(pickOnOrBefore(seriesBySymbol[cfg.symbol] || [], date) || { date }, cfg));
  const sectors = from(US_SECTORS);
  const rising = sectors.filter((x) => Number(x.changePct) > 0).sort((a, b) => Number(b.changePct) - Number(a.changePct));
  const falling = sectors.filter((x) => Number(x.changePct) < 0).sort((a, b) => Number(a.changePct) - Number(b.changePct));
  const report = sanitizeReport({ date, collectedAt, source, indices: from(US_INDICES), focus: from(US_FOCUS), rates: from(US_RATES), sectors: { rising, falling }, memo: '' });
  return { ...report, interpretation: generateInterpretation(report) };
}

export function sanitizeReport(input = {}) {
  const cfgByKey = new Map(ALL_ITEMS.map((x) => [x.key, x]));
  const cleanList = (list) => Array.isArray(list) ? list.map((x) => sanitizeMarketItem(x, cfgByKey.get(x.key) || x)) : [];
  const report = {
    date: String(input.date || '').slice(0, 10),
    collectedAt: String(input.collectedAt || ''),
    source: String(input.source || 'yahoo'),
    memo: String(input.memo || '').slice(0, 1000),
    interpretation: String(input.interpretation || '').slice(0, 1000),
    indices: cleanList(input.indices).slice(0, 4),
    focus: cleanList(input.focus).slice(0, 2),
    rates: cleanList(input.rates).slice(0, 1),
    sectors: {
      rising: cleanList(input.sectors?.rising).slice(0, 5),
      falling: cleanList(input.sectors?.falling).slice(0, 5),
    },
  };
  if (!report.interpretation) report.interpretation = generateInterpretation(report);
  return report;
}

export function applyMemo(report, memo) {
  return sanitizeReport({ ...report, memo });
}

export async function fetchYahooSeries(symbol, fromDate, toDate) {
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?period1=${toUnix(fromDate, -7)}&period2=${toUnix(toDate, 2)}&interval=1d&events=history`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Yahoo chart ${res.status}: ${symbol}`);
  return normalizeYahooSeries(symbol, await res.json());
}

export async function fetchUsMarketReports(dates = []) {
  const sorted = [...new Set(dates)].sort();
  if (!sorted.length) return [];
  const fromDate = sorted[0];
  const toDate = sorted.at(-1);
  const entries = await Promise.all(ALL_ITEMS.map(async (cfg) => [cfg.symbol, await fetchYahooSeries(cfg.symbol, fromDate, toDate)]));
  const seriesBySymbol = Object.fromEntries(entries);
  return sorted.map((date) => buildReportForDate({ date, seriesBySymbol }));
}
