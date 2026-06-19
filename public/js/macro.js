// 매크로 지표 탭 렌더링. 지표별 카드 — 시리즈마다 최신값 + 전기대비 + SVG 스파크라인.
// 데이터 소스는 읽기 전용(public/data/macro/macro.json), 사용자 입력 없음.

const NA = '—';
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// --- 순수 헬퍼 (테스트 대상) ---

// 유효 포인트(value가 숫자)만 추린다.
function validPoints(points) {
  return (points ?? []).filter((p) => isNum(p?.value));
}
export function latestPoint(points) {
  const arr = validPoints(points);
  return arr.length ? arr[arr.length - 1] : null;
}
export function prevPoint(points) {
  const arr = validPoints(points);
  return arr.length >= 2 ? arr[arr.length - 2] : null;
}
// 전기대비 변화량(최신 − 직전). 둘 중 하나라도 없으면 null.
export function changeOf(points) {
  const a = latestPoint(points);
  const b = prevPoint(points);
  return a && b ? a.value - b.value : null;
}

// 숫자 포맷: 천단위 + 소수 자리수 고정.
export function fmtNum(n, decimals = 2) {
  if (!isNum(n)) return NA;
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
// 부호 포함 변화량(소수 자리수 고정). 보합은 부호 없음.
export function fmtChange(n, decimals = 2) {
  if (!isNum(n)) return NA;
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return sign + fmtNum(Math.abs(n), decimals);
}
// 변화 방향 → 톤(한국식: 상승=빨강, 하락=파랑, 보합=중립).
export function changeTone(n) {
  if (!isNum(n) || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}

// 임계값 침범(위험) 여부 — 양방향. aboveIsBad면 value>기준, belowIsBad면 value<기준일 때 true.
export function thresholdBreached(value, threshold) {
  if (!isNum(value) || !threshold || !isNum(threshold.value)) return false;
  if (threshold.aboveIsBad && value > threshold.value) return true;
  if (threshold.belowIsBad && value < threshold.value) return true;
  return false;
}
// 하위 호환: belowIsBad 임계 침체 여부(ISM 등). thresholdBreached의 특수형.
export function belowThreshold(value, threshold) {
  return threshold?.belowIsBad ? thresholdBreached(value, threshold) : false;
}

// SVG 스파크라인 좌표열. points → "x,y x,y ..." (viewBox 0..w × 0..h, 값↑ → y↓).
// 포인트 2개 미만이면 빈 문자열(선 없음).
export function sparklinePoints(points, w = 116, h = 30, pad = 3) {
  const vals = validPoints(points).map((p) => p.value);
  if (vals.length < 2) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const n = vals.length;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const r = (x) => Math.round(x * 100) / 100;
  return vals
    .map((v, i) => {
      const x = pad + (innerW * i) / (n - 1);
      const y = pad + innerH * (1 - (v - min) / span);
      return `${r(x)},${r(y)}`;
    })
    .join(' ');
}

// --- 봉차트 집계 (테스트 대상) ---

// 시리즈가 봉차트(OHLC)인가 — 포인트가 있고 전부 open/high/low/close를 가질 때.
export function seriesHasOHLC(series) {
  const pts = series?.points ?? [];
  return pts.length > 0 && pts.every((p) =>
    isNum(p?.open) && isNum(p?.high) && isNum(p?.low) && isNum(p?.close));
}

// 포인트 → 봉(없으면 value로 시=고=저=종 평탄봉). 레벨형 라인도 같은 형태로 다룬다.
function toBar(p) {
  if (isNum(p.open) && isNum(p.high) && isNum(p.low) && isNum(p.close)) {
    return { time: p.date, open: p.open, high: p.high, low: p.low, close: p.close };
  }
  return { time: p.date, open: p.value, high: p.value, low: p.value, close: p.value };
}

// ISO 8601 주차 키 'YYYY-Www' (목요일 기준). UTC로 계산해 타임존 영향 없음.
export function isoWeekKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - day + 3); // 그 주의 목요일
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// 기간 버킷 키. period: 'D'|'W'|'M'|'Y'.
function bucketKey(dateStr, period) {
  if (period === 'W') return isoWeekKey(dateStr);
  if (period === 'M') return dateStr.slice(0, 7); // YYYY-MM
  if (period === 'Y') return dateStr.slice(0, 4); // YYYY
  return dateStr; // 'D' — 일별 그대로
}

// 일별 포인트를 기간(일/주/월/연)으로 집계 → 봉 배열(시간 오름차순).
// 각 버킷: open=첫 봉의 시가, high=최고, low=최저, close=마지막 봉의 종가, time=버킷 마지막 날짜.
export function aggregateOHLC(points, period = 'D') {
  const valid = (points ?? []).filter((p) => isNum(p?.value) && /^\d{4}-\d{2}-\d{2}$/.test(p?.date));
  const sorted = [...valid].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (period === 'D') return sorted.map(toBar);

  const buckets = new Map(); // key → {bars[], lastDate}
  for (const p of sorted) {
    const key = bucketKey(p.date, period);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(toBar(p));
  }
  const out = [];
  for (const bars of buckets.values()) {
    out.push({
      time: bars[bars.length - 1].time,
      open: bars[0].open,
      high: Math.max(...bars.map((b) => b.high)),
      low: Math.min(...bars.map((b) => b.low)),
      close: bars[bars.length - 1].close,
    });
  }
  return out.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

// --- DOM 헬퍼 ---

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
// SVG 요소 — 테스트 스텁(FakeEl)엔 createElementNS/setAttribute가 없어 가드.
function svgEl(tag, attrs) {
  const node = document.createElementNS
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag);
  if (attrs && node.setAttribute) for (const k of Object.keys(attrs)) node.setAttribute(k, attrs[k]);
  return node;
}

// 시리즈 한 줄: 이름 · 최신값(+단위) · 전기대비 · 스파크라인.
// threshold가 있고 최신값이 침체구간이면 값에 침체 톤 + '침체' 태그.
function seriesRow(series, unit, decimals, threshold = null) {
  const row = el('div', undefined, 'macro-srow');
  const last = latestPoint(series.points);
  const chg = changeOf(series.points);
  const warn = last && thresholdBreached(last.value, threshold);

  row.appendChild(el('span', series.name, 'macro-sname'));

  // 값 셀: 숫자 + (침체 시) 태그. 그리드 컬럼 수를 유지하려 한 셀 안에 묶는다.
  const valText = last ? `${fmtNum(last.value, decimals)}${unit ? ` ${unit}` : ''}` : NA;
  const valCell = el('span', undefined, `macro-svalue${warn ? ' warn' : ''}`);
  valCell.appendChild(el('span', valText, 'macro-svalue-num'));
  if (warn) valCell.appendChild(el('span', threshold.label || '침체', 'macro-stag'));
  row.appendChild(valCell);

  row.appendChild(el('span', fmtChange(chg, decimals), `macro-schange ${changeTone(chg)}`));

  // 스파크라인
  const pts = sparklinePoints(series.points);
  const svg = svgEl('svg', { class: 'macro-spark', viewBox: '0 0 116 30', preserveAspectRatio: 'none' });
  if (pts) {
    svg.appendChild(svgEl('polyline', { points: pts, fill: 'none', 'stroke-width': '1.5' }));
  }
  row.appendChild(svg);

  return row;
}

// 지표 카드: 헤더(라벨 + 출처) + 시리즈 줄들 + 기준일. 클릭 시 onOpen(ind) → 차트 모달.
// threshold가 있고 시리즈 최신값이 하나라도 침체구간이면 카드 경고 톤 + '침체 신호' 배지.
function indicatorCard(ind, onOpen) {
  const threshold = ind.threshold ?? null;
  const series = ind.series ?? [];
  const recession = series.some((s) => thresholdBreached(latestPoint(s.points)?.value, threshold));

  const card = el('div', undefined, 'macro-card' + (onOpen ? ' macro-card-clickable' : '') + (recession ? ' macro-card-warn' : ''));
  if (onOpen) {
    card.tabIndex = 0;
    card.addEventListener('click', () => onOpen(ind));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(ind); }
    });
  }

  const head = el('div', undefined, 'macro-card-head');
  head.appendChild(el('span', ind.label, 'macro-label'));
  if (recession) head.appendChild(el('span', `${threshold.label || '침체'} 신호`, 'macro-badge-warn'));
  if (ind.source) head.appendChild(el('span', ind.source, 'macro-source'));
  card.appendChild(head);

  const body = el('div', undefined, 'macro-series');
  for (const s of series) body.appendChild(seriesRow(s, ind.unit ?? '', ind.decimals ?? 2, threshold));
  card.appendChild(body);

  // 기준일: 시리즈들의 최신 포인트 중 가장 최근 날짜.
  const asOf = (ind.series ?? [])
    .map((s) => latestPoint(s.points)?.date)
    .filter(Boolean)
    .sort()
    .pop();
  if (asOf) card.appendChild(el('div', `기준일 ${asOf}`, 'macro-asof'));
  if (onOpen) card.appendChild(el('div', '클릭하여 차트 보기 ›', 'macro-cta'));

  return card;
}

// container에 매크로 지표 탭을 그린다.
// opts: { data: { indicators[], seed? }, onOpenChart(ind) }
export function renderMacro(container, { data = null, onOpenChart = null } = {}) {
  container.innerHTML = '';

  const section = el('section', undefined, 'macro');
  const indicators = Array.isArray(data?.indicators) ? data.indicators : [];

  if (!indicators.length) {
    section.appendChild(el('p', '매크로 지표 데이터가 없습니다.', 'macro-empty'));
    container.appendChild(section);
    return;
  }

  if (data?.seed) {
    section.appendChild(el('p', '샘플 데이터입니다 — 실시간 수집(ECOS·FRED) 연결 전 표시용 값입니다.', 'macro-notice'));
  }

  const grid = el('div', undefined, 'macro-grid');
  for (const ind of indicators) grid.appendChild(indicatorCard(ind, onOpenChart));
  section.appendChild(grid);

  container.appendChild(section);
}
