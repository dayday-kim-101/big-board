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
    rows: (g.tickers ?? []).map((t) => {
      // memo row는 시세 조회 없이 그대로 통과.
      if (t.type === 'memo') return { type: 'memo', id: t.id, text: t.text ?? '' };
      return {
        market: t.market,
        code: t.code,
        name: t.name || code(t),
        quote: q[`${t.market}:${t.code}`] ?? null,
      };
    }),
  }));
  return groups;
}

function code(t) {
  return t.code;
}

// --- 재료정리 보드: 임계값 강조 술어 (배경색 표시 조건) ---
// 값이 숫자가 아니면 항상 false(강조 안 함).
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

export function isHotChange(changePct) {
  return isNum(changePct) && changePct >= 10; // 등락률 10% 이상
}
export function isSmallCap(marketCap) {
  return isNum(marketCap) && marketCap <= 2e12; // 시가총액 2조원 이하
}
export function isHighTradingValue(tradingValue) {
  return isNum(tradingValue) && tradingValue >= 4e11; // 거래대금 4천억원 이상
}
export function isHighTvRatio(pct) {
  return isNum(pct) && pct > 20; // 시총대비 거래대금 비율 20 초과
}

// 원 단위 → 조/억 표기. 재료정리 보드의 시가총액·거래대금 공통 포맷.
export function fmtWonKR(n) {
  if (!isNum(n)) return NA;
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}조`;
  if (n >= 1e8) return `${Math.round(n / 1e8).toLocaleString('en-US')}억`;
  return Math.round(n).toLocaleString('en-US');
}

// 날짜(YYYY-MM-DD) → 요일 표기 추가. 예: '2026-06-11' → '2026-06-11(Thu.)'.
// 요일은 UTC 기준으로 결정론적 계산(타임존 영향 없음).
const DOW_ABBR = ['Sun.', 'Mon.', 'Tue.', 'Wed.', 'Thu.', 'Fri.', 'Sat.'];
export function fmtDateWithDow(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return date || '';
  const dow = DOW_ABBR[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return dow ? `${date}(${dow})` : date;
}

// 등락률 내림차순 정렬(원본 불변). null/NaN 등락률은 말단으로.
export function sortByChangeDesc(rows) {
  return [...(rows ?? [])].sort((a, b) => {
    const av = isNum(a?.changePct) ? a.changePct : -Infinity;
    const bv = isNum(b?.changePct) ? b.changePct : -Infinity;
    return bv - av;
  });
}
