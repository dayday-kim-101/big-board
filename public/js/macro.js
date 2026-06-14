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
function seriesRow(series, unit, decimals) {
  const row = el('div', undefined, 'macro-srow');
  const last = latestPoint(series.points);
  const chg = changeOf(series.points);

  row.appendChild(el('span', series.name, 'macro-sname'));

  const valText = last ? `${fmtNum(last.value, decimals)}${unit ? ` ${unit}` : ''}` : NA;
  row.appendChild(el('span', valText, 'macro-svalue'));

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

// 지표 카드: 헤더(라벨 + 출처) + 시리즈 줄들 + 기준일.
function indicatorCard(ind) {
  const card = el('div', undefined, 'macro-card');

  const head = el('div', undefined, 'macro-card-head');
  head.appendChild(el('span', ind.label, 'macro-label'));
  if (ind.source) head.appendChild(el('span', ind.source, 'macro-source'));
  card.appendChild(head);

  const body = el('div', undefined, 'macro-series');
  for (const s of ind.series ?? []) body.appendChild(seriesRow(s, ind.unit ?? '', ind.decimals ?? 2));
  card.appendChild(body);

  // 기준일: 시리즈들의 최신 포인트 중 가장 최근 날짜.
  const asOf = (ind.series ?? [])
    .map((s) => latestPoint(s.points)?.date)
    .filter(Boolean)
    .sort()
    .pop();
  if (asOf) card.appendChild(el('div', `기준일 ${asOf}`, 'macro-asof'));

  return card;
}

// container에 매크로 지표 탭을 그린다. opts: { data: { indicators[], seed? } }
export function renderMacro(container, { data = null } = {}) {
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
  for (const ind of indicators) grid.appendChild(indicatorCard(ind));
  section.appendChild(grid);

  container.appendChild(section);
}
