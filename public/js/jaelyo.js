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

// 종목코드 클릭 팝업에 '읽기 전용'으로 보여줄 구조화 필드 요약 — { label(표시), key(manual 필드) }.
// 팝업은 구조화 필드를 편집하지 않는다(그 편집은 표의 inline 셀 전용). 팝업 저장 대상은 오직 notes.
// 라벨은 표 열과 동일하게 맞춰 혼동을 없앤다.
const SUMMARY_FIELDS = [
  { label: '신규/기존', key: 'newOrExisting' },
  { label: '테마', key: 'theme' },
  { label: '재료', key: 'material' },
  { label: '재료지속성', key: 'materialPersistence' },
  { label: '재료연속여부', key: 'materialContinuity' },
  { label: '재무', key: 'financials' },
  { label: '수급', key: 'supplyDemand' },
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

// 종목명 셀: 클릭하면 해당 종목의 메모 팝업을 여는 버튼. (네이버뉴스는 종목코드 셀이 담당)
// onEditManual을 팝업에 전달 → 팝업에서 직접 수정·저장.
function nameCell(row, onEditManual) {
  const td = cell('td', undefined, 'name');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'jaelyo-name-btn';
  btn.textContent = row.name;
  btn.title = `${row.name} 메모 보기·수정`;
  btn.addEventListener('click', () => openMemoModal(row, { onEditManual }));
  td.appendChild(btn);
  return td;
}

// 종목코드 셀: 새 탭으로 네이버뉴스 검색을 여는 앵커. 검색어는 종목명, 표시 텍스트는 종목코드.
// 수집 날짜로 기간을 제한. (메모 팝업은 종목명 셀이 담당)
function codeCell(row, date) {
  const td = cell('td', undefined, 'code');
  const a = document.createElement('a');
  a.className = 'jaelyo-code-link';
  a.textContent = row.code;
  a.href = naverNewsSearchUrl(row.name, date);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = `${row.name} 네이버뉴스 검색${date ? ` (${date})` : ''}`;
  // 명시적으로 새 탭/새 창을 우선 시도 — 일부 환경에서 target="_blank"만으론
  // 현재 페이지가 대체돼 주식전광판으로 돌아오기 불편하다는 피드백 반영.
  // window.open이 성공(팝업 허용)했을 때만 기본 이동을 막고, 없거나 차단/테스트
  // 환경이면 anchor 기본 target="_blank" 이동으로 안전하게 폴백한다.
  a.addEventListener('click', (ev) => {
    const opener = typeof window !== 'undefined' && typeof window.open === 'function' ? window.open : null;
    if (!opener) return; // window.open 없음 → anchor 기본 새 탭 폴백
    let opened = null;
    try {
      opened = opener(a.href, '_blank', 'noopener,noreferrer');
    } catch {
      opened = null; // 팝업 차단 등 예외 → 기본 동작으로 폴백
    }
    if (opened) ev.preventDefault?.();
  });
  td.appendChild(a);
  return td;
}

// 구조화 필드 요약 한 줄(읽기 전용): 라벨 + 현재 값(빈 값이면 —). 편집 불가.
// 구조화 필드 수정은 표의 inline 셀에서만 한다 — 팝업은 참고용 표시 + notes 편집 전용.
function summaryField(field, manual) {
  const wrap = cell('div', undefined, 'memo-row memo-summary-row');
  const label = cell('label', field.label, 'memo-label');
  const value = cell('div', manual?.[field.key] || NA, 'memo-value');
  wrap.append(label, value);
  return wrap;
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

// 종목명 클릭 → 메모 팝업(dialog). 종목명/코드 + 구조화 필드 '읽기 전용' 요약 + 자유 메모 textarea + 저장 버튼.
// 팝업은 구조화 필드(theme/material/…)를 편집하지 않는다 — 저장 대상은 오직 notes(자유 메모).
// 저장: onEditManual(code, { notes }) 호출 → 성공 시 팝업 닫힘(테이블은 콜백이 갱신), 실패 시 팝업 유지.
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
  // 구조화 필드는 읽기 전용 요약으로만 보여준다(편집은 표 inline 셀 전용).
  for (const f of SUMMARY_FIELDS) body.appendChild(summaryField(f, manual));
  // 편집·저장 대상은 자유 메모(notes) 하나뿐.
  const notes = notesField(manual, row);
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

  // 저장: 자유 메모(notes)만 patch로 보낸다. 구조화 필드는 절대 포함하지 않는다.
  saveBtn.addEventListener('click', async () => {
    const patch = { notes: notes.get() };
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

// 현재가 셀: onChart 있으면 클릭 시 차트를 여는 버튼(재료정리는 한국 종목만),
// 없으면 일반 텍스트. 버튼은 {market:'KR', code, name}을 onChart에 넘긴다.
function priceCell(row, onChart) {
  const text = fmtPrice(row.price, 'KR');
  if (!onChart) return cell('td', text, 'num');
  const td = cell('td', undefined, 'num');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'jaelyo-price-btn';
  btn.textContent = text;
  btn.title = `${row.name} 차트 보기`;
  btn.addEventListener('click', () => onChart({ market: 'KR', code: row.code, name: row.name }));
  td.appendChild(btn);
  return td;
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

function dailyThemePanel(dailyTheme, onEditDailyTheme) {
  const panel = cell('section', undefined, 'jaelyo-theme-panel');
  const head = cell('div', undefined, 'jaelyo-theme-head');
  head.appendChild(cell('h3', '오늘의 테마', 'jaelyo-theme-title'));
  const badgeText = dailyTheme?.source === 'manual'
    ? '수동 수정'
    : `상승·${Math.round((dailyTheme?.criteria?.minTradingValue ?? 400_000_000_000) / 100_000_000)}억+·등락률${dailyTheme?.criteria?.rankLimit ?? 30}·개수기준`;
  head.appendChild(cell('span', badgeText, 'jaelyo-theme-badge'));
  panel.appendChild(head);

  const ta = document.createElement('textarea');
  ta.className = 'jaelyo-theme-text';
  ta.rows = 2;
  ta.placeholder = '그날 거래대금이 몰린 테마를 정리하세요';
  ta.value = dailyTheme?.text || '';
  panel.appendChild(ta);

  const items = dailyTheme?.items || [];
  if (items.length) {
    const chips = cell('div', undefined, 'jaelyo-theme-chips');
    for (const it of items.slice(0, 6)) {
      const top = (it.topStocks || []).slice(0, 3).map((s) => s.name).join(', ');
      chips.appendChild(cell('span', `${it.theme} ${Number(it.sharePct || 0).toFixed(1)}%${top ? ` · ${top}` : ''}`, 'jaelyo-theme-chip'));
    }
    panel.appendChild(chips);
  }

  const actions = cell('div', undefined, 'jaelyo-theme-actions');
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'jaelyo-theme-save';
  save.textContent = '테마 저장';
  save.addEventListener('click', async () => {
    const label = save.textContent;
    save.disabled = true;
    save.textContent = '저장 중…';
    const ok = await onEditDailyTheme?.({ ...dailyTheme, text: ta.value });
    save.disabled = false;
    save.textContent = ok === false ? '다시 저장' : label;
  });
  actions.appendChild(save);
  panel.appendChild(actions);
  return panel;
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
// opts: { dates[], selectedDate, board:{rows[]}, onSelectDate(date), onEditManual(code, patch), onEditDailyTheme(dailyTheme), onChart({market,code,name}) }
export function renderJaelyo(container, { dates = [], selectedDate = null, board = null, onSelectDate, onEditManual, onEditDailyTheme, onChart } = {}) {
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

  if (board) section.appendChild(dailyThemePanel(board.dailyTheme, onEditDailyTheme));

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
    tr.appendChild(codeCell(r, newsDate));
    tr.appendChild(nameCell(r, onEditManual));
    tr.appendChild(priceCell(r, onChart));
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
