// 섹터맵(finviz 스타일 treemap) — 타일 면적 = 시가총액 비례, 색상 = 당일 등락률.
// squarified treemap(Bruls et al.) 순수 구현. 안전을 위해 textContent 사용.
import { priceTone, fmtPct } from './format.js';

const NA = '—';
const INTENSITY_CAP_PCT = 3; // |등락률| 3%에서 색 농도 최대
const SECTOR_HEAD_H = 20; // 섹터 이름 스트립 높이(px)
const GAP = 2; // 섹터 사이 여백(px)

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

// 등락률 → 타일 배경색. 한국식: 상승=빨강, 하락=파랑, 보합/시세없음=중립 회색.
// 농도는 |등락률|을 INTENSITY_CAP_PCT에서 캡해 비례 스케일(var(--up)/var(--down)과 같은 색상값).
export function tileBg(changePct) {
  const tone = priceTone(changePct);
  if (tone === 'up' || tone === 'down') {
    const ratio = Math.min(Math.abs(changePct), INTENSITY_CAP_PCT) / INTENSITY_CAP_PCT;
    const alpha = (0.16 + 0.64 * ratio).toFixed(2);
    return tone === 'up' ? `rgba(255, 77, 79, ${alpha})` : `rgba(77, 123, 255, ${alpha})`;
  }
  return 'rgba(194, 200, 212, 0.08)';
}

// 시총(조) 표기. 예: 1558.5 → '1,558.5조'. 숫자가 아니면 —.
export function fmtCapTrillion(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return NA;
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}조`;
}

// squarified treemap. weights(양수, 내림차순 권장)를 (x,y,w,h) 안에
// 면적 비례 사각형으로 배치해 [{x,y,w,h}] 반환. 정사각형에 가깝게 행 단위로 채움.
export function squarify(weights, x, y, w, h) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0) || !(w > 0) || !(h > 0)) return weights.map(() => ({ x, y, w: 0, h: 0 }));
  const scale = (w * h) / total;
  const areas = weights.map((v) => v * scale);
  const rects = [];
  let cx = x, cy = y, cw = w, ch = h;
  let i = 0;
  while (i < areas.length) {
    // 남은 영역의 짧은 변을 따라 한 행(row)을 채운다. 최악 종횡비가 나빠지기 직전까지 타일 추가.
    const side = Math.min(cw, ch);
    let row = [areas[i]];
    let rowSum = areas[i];
    let worst = worstAspect(row, rowSum, side);
    let j = i + 1;
    while (j < areas.length) {
      const nextSum = rowSum + areas[j];
      const nextWorst = worstAspect(row.concat(areas[j]), nextSum, side);
      if (nextWorst > worst) break;
      row.push(areas[j]);
      rowSum = nextSum;
      worst = nextWorst;
      j += 1;
    }
    const thickness = rowSum / side;
    let off = 0;
    if (cw >= ch) {
      // 가로가 길면 왼쪽에 세로 스트립
      for (const a of row) {
        const len = a / thickness;
        rects.push({ x: cx, y: cy + off, w: thickness, h: len });
        off += len;
      }
      cx += thickness;
      cw -= thickness;
    } else {
      // 세로가 길면 위쪽에 가로 스트립
      for (const a of row) {
        const len = a / thickness;
        rects.push({ x: cx + off, y: cy, w: len, h: thickness });
        off += len;
      }
      cy += thickness;
      ch -= thickness;
    }
    i = j;
  }
  return rects;
}

function worstAspect(row, sum, side) {
  const thickness = sum / side;
  let worst = 1;
  for (const a of row) {
    const len = a / thickness;
    const ar = Math.max(thickness / len, len / thickness);
    if (ar > worst) worst = ar;
  }
  return worst;
}

function setRect(node, r) {
  if (!node.style) return; // 테스트 스텁 등 style 미제공 환경 가드
  node.style.left = `${r.x.toFixed(2)}px`;
  node.style.top = `${r.y.toFixed(2)}px`;
  node.style.width = `${Math.max(0, r.w).toFixed(2)}px`;
  node.style.height = `${Math.max(0, r.h).toFixed(2)}px`;
}

function capOf(c) {
  const n = Number(c?.capTrillion);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 섹터맵 렌더. sectors = [{ name, totalCapTrillion, companies: [{ name, code, capTrillion, desc }] }],
// quotes 키는 "MARKET:CODE" — 시세 없는 종목은 중립 톤으로 표시.
export function renderSectorMap(container, { sectors = [], quotes = {} } = {}) {
  container.innerHTML = '';
  const section = el('section', undefined, 'sectormap');
  const list = Array.isArray(sectors) ? sectors.filter((s) => (s.companies ?? []).some(capOf)) : [];
  if (!list.length) {
    section.appendChild(el('p', '섹터 데이터가 없습니다.', 'sectormap-empty'));
    container.appendChild(section);
    return;
  }
  const map = el('div', undefined, 'sectormap-map');
  section.appendChild(map);
  container.appendChild(section);
  paintMap(map, list, quotes);

  // 창 크기 변경 시 재배치(브라우저 환경에서만). 이전 리스너는 교체.
  if (typeof window !== 'undefined' && window.addEventListener) {
    if (container._sectormapOnResize) window.removeEventListener('resize', container._sectormapOnResize);
    let timer = null;
    container._sectormapOnResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (map.isConnected) paintMap(map, list, quotes);
      }, 150);
    };
    window.addEventListener('resize', container._sectormapOnResize);
  }
}

function paintMap(map, sectors, quotes) {
  map.innerHTML = '';
  const rect = typeof map.getBoundingClientRect === 'function' ? map.getBoundingClientRect() : null;
  const W = rect && rect.width > 0 ? rect.width : 1600;
  const H = rect && rect.height > 0 ? rect.height : 900;

  // 섹터 면적 = 소속 종목 시총 합. 큰 섹터부터 배치해야 정사각형에 가까워짐.
  const items = sectors
    .map((s) => ({
      sector: s,
      companies: (s.companies ?? []).filter(capOf).slice().sort((a, b) => capOf(b) - capOf(a)),
      weight: (s.companies ?? []).reduce((sum, c) => sum + capOf(c), 0),
    }))
    .sort((a, b) => b.weight - a.weight);

  // 요약 패널 — 작은 타일은 글자가 안 보이므로 hover/클릭 시 섹터 전체 종목을 나열.
  const panel = el('div', undefined, 'sectormap-panel');
  const ui = { pinned: null, panel, quotes, W, H };

  const rects = squarify(items.map((it) => it.weight), 0, 0, W, H);
  items.forEach((it, idx) => map.appendChild(buildSector(it, rects[idx], quotes, ui)));
  map.appendChild(panel);
  map.addEventListener('mouseleave', () => {
    if (!ui.pinned) hidePanel(panel);
  });
}

function hidePanel(panel) {
  panel.className = 'sectormap-panel';
}

// 섹터 요약 패널 표시. 왼쪽 절반 섹터면 오른쪽에, 오른쪽 절반이면 왼쪽에 띄우고 맵 안으로 클램프.
function showPanel(item, r, ui, pinned) {
  const { panel, quotes, W, H } = ui;
  panel.innerHTML = '';
  panel.className = 'sectormap-panel open' + (pinned ? ' pinned' : '');

  const head = el('div', undefined, 'sectormap-panel-head');
  head.appendChild(el('strong', item.sector.name ?? ''));
  head.appendChild(el(
    'span',
    ` · ${fmtCapTrillion(item.sector.totalCapTrillion)} · ${item.companies.length}종목`,
    'sectormap-panel-sub'
  ));
  if (pinned) {
    const close = el('button', '✕', 'sectormap-panel-close');
    close.addEventListener('click', () => {
      ui.pinned = null;
      hidePanel(panel);
    });
    head.appendChild(close);
  }
  panel.appendChild(head);

  for (const c of item.companies) {
    const q = quotes?.[`KR:${c.code}`] ?? null;
    const tone = priceTone(q?.changePct ?? null);
    const row = el('div', undefined, 'sectormap-panel-row');
    const left = el('div', undefined, 'sectormap-panel-left');
    left.appendChild(el('div', c.name ?? '', 'sectormap-panel-name'));
    if (c.desc) left.appendChild(el('div', c.desc, 'sectormap-panel-desc'));
    const right = el('div', undefined, 'sectormap-panel-right');
    right.appendChild(el('div', fmtCapTrillion(c.capTrillion), 'sectormap-panel-cap'));
    right.appendChild(el('div', q ? fmtPct(q.changePct) : NA, `sectormap-panel-pct ${tone}`));
    row.append(left, right);
    panel.appendChild(row);
  }

  if (panel.style) {
    const PW = Math.min(340, Math.max(240, W * 0.35));
    const onLeftHalf = r.x + r.w / 2 < W / 2;
    const x = onLeftHalf ? Math.min(r.x + r.w + 6, W - PW - 4) : Math.max(4, r.x - PW - 6);
    const y = Math.max(4, Math.min(r.y, H * 0.3));
    panel.style.left = `${x.toFixed(2)}px`;
    panel.style.top = `${y.toFixed(2)}px`;
    panel.style.width = `${PW.toFixed(2)}px`;
    panel.style.maxHeight = `${(H - y - 8).toFixed(2)}px`;
  }
}

function buildSector(item, r, quotes, ui) {
  const { sector, companies } = item;
  const card = el('div', undefined, 'sectormap-sector');
  setRect(card, { x: r.x + GAP / 2, y: r.y + GAP / 2, w: r.w - GAP, h: r.h - GAP });

  // hover = 미리보기, 클릭 = 고정(재클릭 해제, 다른 섹터 클릭 시 전환). 고정 중엔 hover 무시.
  card.addEventListener('mouseenter', () => {
    if (!ui.pinned) showPanel(item, r, ui, false);
  });
  card.addEventListener('click', () => {
    if (ui.pinned === sector) {
      ui.pinned = null;
      hidePanel(ui.panel);
    } else {
      ui.pinned = sector;
      showPanel(item, r, ui, true);
    }
  });

  const innerW = r.w - GAP;
  const innerH = r.h - GAP;
  const headH = innerH >= SECTOR_HEAD_H * 2 ? SECTOR_HEAD_H : 0;
  if (headH) {
    const head = el('div', undefined, 'sectormap-sector-head');
    head.appendChild(el('strong', sector.name ?? ''));
    // 좁은 섹터는 시총 생략 — 이름이 잘리는 것 방지
    if (innerW >= 110) {
      head.appendChild(el('span', ` · ${fmtCapTrillion(sector.totalCapTrillion)}`, 'sectormap-sector-cap'));
    }
    card.appendChild(head);
  }

  const tileRects = squarify(companies.map(capOf), 0, headH, innerW, Math.max(0, innerH - headH));
  companies.forEach((c, idx) => card.appendChild(buildTile(c, tileRects[idx], quotes)));
  return card;
}

function buildTile(c, r, quotes) {
  const q = quotes?.[`KR:${c.code}`] ?? null;
  const changePct = q?.changePct ?? null;
  const tone = priceTone(changePct);
  const tile = el('div', undefined, `sectormap-tile ${tone}`);
  setRect(tile, r);
  if (tile.style) tile.style.background = tileBg(changePct);
  if (c.desc) tile.title = `${c.name} ${fmtCapTrillion(c.capTrillion)} — ${c.desc}`; // 사업내용 툴팁

  // finviz처럼 타일이 클수록 글자도 크게. 좁으면 시총/등락률 줄부터 생략.
  const name = c.name ?? '';
  const fs = Math.min(
    24,
    Math.sqrt(r.w * r.h) / 6,
    (r.w - 8) / Math.max(2, name.length), // 한글 폭 ≈ 1em
    r.h * 0.42
  );
  if (fs >= 8) {
    const nameEl = el('div', name, 'sectormap-tile-name');
    if (nameEl.style) nameEl.style.fontSize = `${fs.toFixed(1)}px`;
    tile.appendChild(nameEl);
    if (q && r.h >= fs * 2.4) {
      const pctEl = el('div', fmtPct(changePct), `sectormap-tile-pct ${tone}`);
      if (pctEl.style) pctEl.style.fontSize = `${Math.max(8, fs * 0.78).toFixed(1)}px`;
      tile.appendChild(pctEl);
    }
    if (r.h >= fs * 3.6 && r.w >= 64) {
      tile.appendChild(el('div', fmtCapTrillion(c.capTrillion), 'sectormap-tile-cap'));
    }
  }
  return tile;
}
