// 순수 표시 로직 — DOM 비의존, 테스트 대상.

// 등락 방향 → 색 톤. 한국식: 상승=빨강, 하락=파랑, 보합=중립.
export function priceTone(change) {
  if (change === null || change === undefined || Number.isNaN(change)) return 'na';
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'flat';
}

const NA = '—';

export function fmtPrice(n, market) {
  if (n === null || n === undefined || Number.isNaN(n)) return NA;
  const digits = market === 'US' ? 2 : 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// 부호 포함 등락폭
export function fmtSigned(n, market) {
  if (n === null || n === undefined || Number.isNaN(n)) return NA;
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return sign + fmtPrice(Math.abs(n), market);
}

export function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return NA;
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

export function fmtVolume(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return NA;
  return Math.round(n).toLocaleString('en-US');
}

// 거래대금: KR은 조/억 단위, US는 $ compact.
export function fmtTradingValue(n, market) {
  if (n === null || n === undefined || Number.isNaN(n)) return NA;
  if (market === 'US') {
    if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    return `$${Math.round(n).toLocaleString('en-US')}`;
  }
  // KR (원)
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}조`;
  if (n >= 1e8) return `${Math.round(n / 1e8).toLocaleString('en-US')}억`;
  return Math.round(n).toLocaleString('en-US');
}

// 목록(groups) + 스냅샷 quotes 맵 → 그룹별 표시용 행 병합.
// quotes 키는 "MARKET:CODE". 시세 없으면 quote:null.
export function mergeBoard(list, quotes) {
  const q = quotes || {};
  const groups = (list?.groups ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    market: g.market ?? null,
    rows: (g.tickers ?? []).map((t) => ({
      market: t.market,
      code: t.code,
      name: t.name || code(t),
      quote: q[`${t.market}:${t.code}`] ?? null,
    })),
  }));
  return groups;
}

function code(t) {
  return t.code;
}
