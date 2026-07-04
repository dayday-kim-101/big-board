// 재료정리 보드 렌더링 (DOM). 전광판 아래 영역.
// 자동 열(순위~시총대비)은 표시 전용, 수동 열(신규/기존~수급)은 입력·저장.
import {
  fmtPrice, fmtPct,
  isHotChange, isSmallCap, isHighTradingValue, isHighTvRatio,
  fmtWonKR, sortByChangeDesc, fmtDateWithDow,
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

// 종목코드 클릭 시 뜨는 메모 팝업에서 편집하는 구조화 항목 — { label(표시), key(manual 필드), type?, options? }.
// MANUAL_FIELDS엔 '세계/국내 영향력' 전용 키가 없어, 의미가 가장 가까운 기존 수동필드에 매핑한다:
//   세계 영향력 ← materialContinuity(재료연속여부: 재료의 글로벌·지속 영향)
//   국내 영향력 ← supplyDemand(수급: 국내 수급/영향)
// 각 manual 키는 정확히 한 번만 노출된다. 팝업에서 직접 수정·저장 가능(자유 메모 notes는 별도 textarea).
const MEMO_FIELDS = [
  { label: '테마', key: 'theme' },
  { label: '재료', key: 'material' },
  { label: '세계 영향력', key: 'materialContinuity' },
  { label: '국내 영향력', key: 'supplyDemand' },
  { label: '재료지속성', key: 'materialPersistence' },
  { label: '재무', key: 'financials' },
  { label: '신규/기존', key: 'newOrExisting', type: 'select', options: ['', '신규', '기존'] },
];

// 자유 메모(notes) 최대 길이 — 서버 _jaelyo-core.NOTES_MAX_LEN과 일치시켜야 한다
// (public/은 functions/를 import할 수 없어 별도 정의).
const NOTES_MAX_LEN = 4000;

// 열 너비 조절(드래그) — 열별 기본 너비(px). 사용자가 끌어 조절하면 localStorage에 저장.
const DEFAULT_COL_W = {
  '순위': 44, '전일순위': 56, '종목코드': 64, '종목명': 104, '현재가': 78, '등락률': 64,
  '시가총액': 86, '거래대금': 90, '시총대비': 64,
  '신규/기존': 72, '테마': 120, '재료': 168, '재료지속성': 96, '재료연속여부': 100, '재무': 128, '수급': 128,
};
const COLW_KEY = 'bigboard:jaelyo:colw';
const MIN_COL_W = 40;

// localStorage는 테스트(Node)엔 없으므로 항상 가드. 손상된 값이면 기본으로 폴백.
function loadColW() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const v = JSON.parse(localStorage.getItem(COLW_KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
function saveColW(map) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(COLW_KEY, JSON.stringify(map));
  } catch {
    /* 저장 불가(시크릿 모드 등) — 무시 */
  }
}
// FakeEl(테스트 스텁)엔 .style가 없으므로 가드. 실제 브라우저에서만 너비 적용.
function setW(el, px) {
  if (el && el.style) el.style.width = `${px}px`;
}

function cell(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}

const NA = '—';
const fmtRank = (n) => (n === null || n === undefined ? NA : String(n));
const fmtRatio = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : NA);

// 종목명 → 네이버뉴스 검색 URL. date(YYYY-MM-DD)가 유효하면 그 날짜 하루로 기간을 제한한다.
// query는 항상 인코딩(공백·특수문자·& 안전). 날짜가 없거나 형식이 어긋나면 기간 없이 검색만.
export function naverNewsSearchUrl(name, date) {
  const query = encodeURIComponent(name ?? '');
  let url = `https://search.naver.com/search.naver?where=news&query=${query}`;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (m) {
    const [, y, mo, d] = m;
    const dot = `${y}.${mo}.${d}`;   // ds/de 형식
    const compact = `${y}${mo}${d}`; // nso from/to 형식
    const nso = `so:r,p:from${compact}to${compact},a:all`;
    url += `&sm=tab_opt&sort=0&pd=3&ds=${dot}&de=${dot}&nso=${encodeURIComponent(nso)}`;
  }
  return url;
}

// 종목명 셀: 새 탭으로 네이버뉴스 검색을 여는 앵커. 수집 날짜로 기간을 제한.
function nameCell(row, date) {
  const td = cell('td', undefined, 'name');
  const a = document.createElement('a');
  a.className = 'jaelyo-name-link';
  a.textContent = row.name;
  a.href = naverNewsSearchUrl(row.name, date);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = `${row.name} 네이버뉴스 검색${date ? ` (${date})` : ''}`;
  td.appendChild(a);
  return td;
}

// 종목코드 셀: 클릭하면 해당 종목의 메모 팝업을 여는 버튼. (네이버뉴스는 종목명 셀이 담당)
// onEditManual을 팝업에 전달 → 팝업에서 직접 수정·저장.
function codeCell(row, onEditManual) {
  const td = cell('td', undefined, 'code');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'code-btn';
  btn.textContent = row.code;
  btn.title = `${row.code} 메모 보기·수정`;
  btn.addEventListener('click', () => openMemoModal(row, { onEditManual }));
  td.appendChild(btn);
  return td;
}

// 메모 팝업 편집 한 줄: 라벨 + 편집 컨트롤(select 또는 text input). get()으로 현재 값 조회.
function memoField(field, manual) {
  const wrap = cell('div', undefined, 'memo-row');
  const label = cell('label', field.label, 'memo-label');
  let input;
  if (field.type === 'select') {
    input = document.createElement('select');
    for (const o of field.options) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o || NA;
      input.appendChild(opt);
    }
  } else {
    input = document.createElement('input');
    input.type = 'text';
  }
  input.className = 'memo-input';
  input.value = manual?.[field.key] ?? '';
  wrap.append(label, input);
  return { wrap, key: field.key, get: () => input.value };
}

// 자유 메모 한 줄: 라벨 + 여러 줄 textarea. notes 우선, 없으면 레거시 memo/row 값으로 폴백.
function notesField(manual, row) {
  const wrap = cell('div', undefined, 'memo-row memo-notes-row');
  const label = cell('label', '메모(자유 작성)', 'memo-label');
  const ta = document.createElement('textarea');
  ta.className = 'memo-input memo-textarea';
  ta.rows = 6;
  ta.maxLength = NOTES_MAX_LEN;
  ta.placeholder = '자유롭게 작성 (여러 줄 가능)';
  ta.value = manual?.notes ?? manual?.memo ?? row?.notes ?? row?.memo ?? '';
  wrap.append(label, ta);
  return { wrap, key: 'notes', get: () => ta.value };
}

// 종목코드 클릭 → 메모 팝업(dialog). 종목명/코드 + MEMO_FIELDS 편집 컨트롤 + 자유 메모 textarea + 저장 버튼.
// 저장: onEditManual(code, patch) 호출 → 성공 시 팝업 닫힘(테이블은 콜백이 갱신), 실패 시 팝업 유지.
// 닫기: ✕ 버튼 · backdrop 클릭 · Escape. 접근성: role=dialog, aria-modal, 제목 연결, 포커스 이동.
export function openMemoModal(row, { onEditManual } = {}) {
  const manual = row?.manual || {};
  const opener = document?.activeElement || null; // 닫을 때 포커스 복원용

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay memo-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal memo-modal';
  const titleId = `memo-title-${row?.code || 'x'}`;
  modal.setAttribute?.('role', 'dialog');
  modal.setAttribute?.('aria-modal', 'true');
  modal.setAttribute?.('aria-labelledby', titleId);

  const head = document.createElement('div');
  head.className = 'modal-head';
  const title = cell('div', `${row?.name ?? ''} · ${row?.code ?? ''}`, 'modal-title');
  title.id = titleId;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.title = '닫기';
  closeBtn.setAttribute?.('aria-label', '닫기');
  closeBtn.textContent = '✕';
  head.append(title, closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body memo-body';
  const editors = [];
  for (const f of MEMO_FIELDS) {
    const ed = memoField(f, manual);
    editors.push(ed);
    body.appendChild(ed.wrap);
  }
  const notes = notesField(manual, row);
  editors.push(notes);
  body.appendChild(notes.wrap);

  const foot = document.createElement('div');
  foot.className = 'modal-foot memo-foot';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'memo-save';
  saveBtn.textContent = '저장';
  foot.appendChild(saveBtn);

  modal.append(head, body, foot);
  overlay.appendChild(modal);

  const remove = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (opener && typeof opener.focus === 'function') opener.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape') remove(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) remove(); });
  closeBtn.addEventListener('click', remove);
  document.addEventListener('keydown', onKey);

  // 저장: 편집한 모든 필드를 patch로 모아 onEditManual 호출. 성공 시에만 닫는다.
  saveBtn.addEventListener('click', async () => {
    const patch = {};
    for (const ed of editors) patch[ed.key] = ed.get();
    saveBtn.disabled = true;
    const label = saveBtn.textContent;
    saveBtn.textContent = '저장 중…';
    let ok = true;
    try {
      ok = await onEditManual?.(row.code, patch);
    } catch {
      ok = false;
    }
    saveBtn.disabled = false;
    saveBtn.textContent = label;
    if (ok !== false) remove(); // 성공(또는 콜백 없음) → 닫기. 실패 시 콜백이 알림·롤백, 팝업 유지.
  });

  document.body.appendChild(overlay);
  if (typeof closeBtn.focus === 'function') closeBtn.focus();
  return overlay;
}

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

// 헤더 셀: 라벨 + 우측 너비 조절 핸들(드래그). 더블클릭 시 기본 너비로 리셋.
// th 개수는 16개로 유지(핸들은 th의 자식). ctx = { widths, widthOf, totalW, table }.
function headerCell(label, colEl, ctx) {
  const th = cell('th', undefined, 'jaelyo-th');
  th.appendChild(cell('span', label, 'th-label'));
  const handle = cell('div', undefined, 'col-resize');
  handle.title = '드래그: 너비 조절 · 더블클릭: 기본값';
  handle.addEventListener('mousedown', (e) => startResize(e, label, colEl, ctx));
  handle.addEventListener('dblclick', () => {
    ctx.widths[label] = DEFAULT_COL_W[label] ?? 120;
    setW(colEl, ctx.widths[label]);
    setW(ctx.table, ctx.totalW());
    saveColW(ctx.widths);
  });
  th.appendChild(handle);
  return th;
}

// 핸들 mousedown → document에 move/up 리스너 부착(드래그 동안만). 실제 브라우저에서만 실행.
function startResize(e, label, colEl, ctx) {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = ctx.widthOf(label);
  const onMove = (ev) => {
    const w = Math.max(MIN_COL_W, Math.round(startWidth + (ev.clientX - startX)));
    ctx.widths[label] = w;
    setW(colEl, w);
    setW(ctx.table, ctx.totalW());
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.classList.remove('col-resizing');
    saveColW(ctx.widths);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.body.classList.add('col-resizing'); // 드래그 중 텍스트 선택 방지(CSS)
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
      opt.value = d; // 값은 원본 YYYY-MM-DD 유지(onSelectDate 계약 불변)
      opt.textContent = fmtDateWithDow(d); // 표시는 요일 포함: 2026-06-11(Thu.)
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

  // 열 너비: 저장값 ∪ 기본값. 드래그 핸들러가 이 객체를 직접 변경·저장한다.
  const widths = { ...DEFAULT_COL_W, ...loadColW() };
  const widthOf = (label) => widths[label] ?? DEFAULT_COL_W[label] ?? 120;
  const totalW = () => COLS.reduce((s, l) => s + widthOf(l), 0);

  // <colgroup>로 열 너비를 제어(table-layout: fixed). col별 width를 인라인으로 적용.
  const colgroup = document.createElement('colgroup');
  const colEls = COLS.map((label) => {
    const col = document.createElement('col');
    setW(col, widthOf(label));
    colgroup.appendChild(col);
    return col;
  });
  table.appendChild(colgroup);
  setW(table, totalW()); // 합계 폭으로 고정 → 넘치면 래퍼가 가로 스크롤

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  COLS.forEach((label, i) => htr.appendChild(headerCell(label, colEls[i], { widths, widthOf, totalW, table })));
  thead.appendChild(htr);
  table.appendChild(thead);

  // 뉴스 검색 기간에 쓸 수집 날짜: 선택 날짜 우선, 없으면 보드 자체 날짜.
  const newsDate = selectedDate || board?.date || null;

  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.appendChild(cell('td', fmtRank(r.rank), 'num'));
    tr.appendChild(cell('td', fmtRank(r.prevRank), 'num prev'));
    tr.appendChild(codeCell(r, onEditManual));
    tr.appendChild(nameCell(r, newsDate));
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
