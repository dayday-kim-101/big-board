// 재료정리 보드 렌더링 (DOM). 전광판 아래 영역.
// 자동 열(순위~시총대비)은 표시 전용, 수동 열(신규/기존~수급)은 입력·저장.
import {
  fmtPrice, fmtPct,
  isHotChange, isSmallCap, isHighTradingValue, isHighTvRatio,
  fmtWonKR, sortByChangeDesc,
} from './format.js';

const COLS = [
  '순위', '전일순위', '종목코드', '종목명', '현재가', '등락률',
  '시가총액', '거래대금', '시총대비', '신규/기존', '테마', '재료',
  '재료지속성', '재료연속여부', '재무', '수급',
];

// 수동 입력 7개 열. 신규/기존은 select.
// key 순서·집합은 서버의 _jaelyo-core MANUAL_FIELDS와 일치해야 한다
// (public/은 functions/를 import할 수 없어 별도 정의 — 정합성은 jaelyo.dom.test의 패리티 테스트가 잠근다).
export const MANUAL_COLS = [
  { key: 'newOrExisting', type: 'select', options: ['', '신규', '기존'] },
  { key: 'theme' },
  { key: 'material' },
  { key: 'materialPersistence' },
  { key: 'materialContinuity' },
  { key: 'financials' },
  { key: 'supplyDemand' },
];

function cell(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}

const NA = '—';
const fmtRank = (n) => (n === null || n === undefined ? NA : String(n));
const fmtRatio = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : NA);

// 강조 술어 true면 기본 클래스에 강조 클래스를 덧붙인다.
function numCls(extra) {
  return extra ? `num ${extra}` : 'num';
}

// 수동 입력 셀: select 또는 text input. 변경(blur) 시 onEditManual(code, {key:value}).
function manualCell(row, col, onEditManual) {
  const td = cell('td', undefined, 'manual');
  let field;
  if (col.type === 'select') {
    field = document.createElement('select');
    for (const o of col.options) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o || NA;
      field.appendChild(opt);
    }
  } else {
    field = document.createElement('input');
    field.type = 'text';
  }
  field.className = 'manual-input';
  field.value = row.manual?.[col.key] ?? '';
  field.addEventListener('change', () => onEditManual?.(row.code, { [col.key]: field.value }));
  td.appendChild(field);
  return td;
}

// container에 재료정리 보드를 그린다.
// opts: { dates[], selectedDate, board:{rows[]}, onSelectDate(date), onEditManual(code, patch) }
export function renderJaelyo(container, { dates = [], selectedDate = null, board = null, onSelectDate, onEditManual } = {}) {
  container.innerHTML = '';

  const section = document.createElement('section');
  section.className = 'jaelyo';

  // 헤더: 제목 + 날짜 드롭다운
  const head = document.createElement('div');
  head.className = 'jaelyo-head';
  head.appendChild(cell('h2', '재료정리', 'jaelyo-title'));

  const select = document.createElement('select');
  select.className = 'jaelyo-date';
  if (!dates.length) {
    const opt = document.createElement('option');
    opt.textContent = '수집된 날짜 없음';
    select.appendChild(opt);
  } else {
    for (const d of dates) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      select.appendChild(opt);
    }
    select.value = selectedDate || dates[0];
    select.addEventListener('change', () => onSelectDate?.(select.value));
  }
  head.appendChild(select);
  section.appendChild(head);

  // 격자 래퍼 — 세로 리사이즈 + 스크롤(CSS)
  const wrap = document.createElement('div');
  wrap.className = 'jaelyo-wrap';

  const rows = sortByChangeDesc(board?.rows);
  if (!rows.length) {
    const msg = selectedDate ? '이 날짜의 수집 데이터가 없습니다.' : '날짜를 선택하세요.';
    wrap.appendChild(cell('p', msg, 'jaelyo-empty'));
    section.appendChild(wrap);
    container.appendChild(section);
    return;
  }

  const table = document.createElement('table');
  table.className = 'jaelyo-table';

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const c of COLS) htr.appendChild(cell('th', c));
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.appendChild(cell('td', fmtRank(r.rank), 'num'));
    tr.appendChild(cell('td', fmtRank(r.prevRank), 'num prev'));
    tr.appendChild(cell('td', r.code, 'code'));
    tr.appendChild(cell('td', r.name, 'name'));
    tr.appendChild(cell('td', fmtPrice(r.price, 'KR'), 'num'));
    tr.appendChild(cell('td', fmtPct(r.changePct), numCls(isHotChange(r.changePct) && 'hot-change')));
    tr.appendChild(cell('td', fmtWonKR(r.marketCap), numCls(isSmallCap(r.marketCap) && 'small-cap')));
    tr.appendChild(cell('td', fmtWonKR(r.tradingValue), numCls(isHighTradingValue(r.tradingValue) && 'high-tv')));
    tr.appendChild(cell('td', fmtRatio(r.tvToMcapPct), numCls(isHighTvRatio(r.tvToMcapPct) && 'high-ratio')));
    for (const mc of MANUAL_COLS) tr.appendChild(manualCell(r, mc, onEditManual));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  section.appendChild(wrap);
  container.appendChild(section);
}
