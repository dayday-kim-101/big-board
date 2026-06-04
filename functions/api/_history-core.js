// 과거 OHLC(캔들) 코어 — Pages Function과 공유. 인터랙티브 차트용.
// KR = 네이버 siseJson(코드만으로 일봉), US = Yahoo chart.
// 출력: { time:'YYYY-MM-DD', open, high, low, close, volume }[]

const UA = 'Mozilla/5.0 (compatible; stock-bigboard/0.1)';

const RANGE_DAYS = { '1mo': 31, '3mo': 93, '6mo': 186, '1y': 372 };

// --- 순수 파서 (네트워크 없음, 테스트 대상) ---

// 네이버 siseJson 응답(JS 배열 리터럴) → 캔들 배열.
export function parseNaverHistory(text) {
  let rows;
  try {
    rows = JSON.parse(String(text).replace(/'/g, '"'));
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows
    .slice(1) // 첫 행은 헤더
    .filter((r) => Array.isArray(r) && r.length >= 5 && /^\d{8}$/.test(String(r[0])))
    .map((r) => ({
      time: String(r[0]).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5] || 0),
    }))
    .filter((c) => Number.isFinite(c.close));
}

// Yahoo chart 응답 → 캔들 배열. 휴장일(null) 제외.
export function parseYahooHistory(json) {
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp;
  const q = r?.indicators?.quote?.[0];
  if (!Array.isArray(ts) || !q) return [];
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    const d = new Date(ts[i] * 1000);
    const time = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    out.push({ time, open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
  }
  return out;
}

// --- 네트워크 ---

function yyyymmdd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

async function fetchKR(code, range) {
  const days = RANGE_DAYS[range] || RANGE_DAYS['6mo'];
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const url =
    `https://api.finance.naver.com/siseJson.naver?symbol=${encodeURIComponent(code)}` +
    `&requestType=1&startTime=${yyyymmdd(start)}&endTime=${yyyymmdd(end)}&timeframe=day`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://finance.naver.com/' } });
  if (!res.ok) throw new Error(`Naver HTTP ${res.status}`);
  return parseNaverHistory(await res.text());
}

async function fetchUS(code, range) {
  const r = RANGE_DAYS[range] ? range : '6mo';
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(code)}?interval=1d&range=${r}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  return parseYahooHistory(await res.json());
}

export async function fetchHistory(market, code, range = '6mo') {
  const m = String(market || '').toUpperCase();
  if (!code) return [];
  if (m === 'KR') return fetchKR(code, range);
  if (m === 'US') return fetchUS(code, range);
  return [];
}
