// 매매기록 탭 렌더링 (DOM). 전광판 아래 영역.
// state.trades = { data: { days:{}, updatedAt } | null }
// handlers = { onPaste(date,records), onManual(date,code,manual), onJournal(date,journal), onResultTag(date,resultTag) }
import { priceTone, fmtPrice, fmtPct } from './format.js';
import { computeStats, parseKiwoomClipboard } from './trades-core.js';

const NA = '—';

// 매매기록 테이블 헤더. 인덱스 순서가 곧 컬럼 순서.
const TABLE_HEADERS = ['코드', '종목명', '매수평균', '매도평균', '수량', '손익', '수익률', '전날종가', '보유일', '매매이유', '테마태그'];
// "보유일"(인덱스 8)부터 오른쪽 컬럼은 사용자가 폭을 조절할 수 있다.
const RESIZE_FROM_INDEX = TABLE_HEADERS.indexOf('보유일');
const COL_MIN_W = 60;   // 최소 폭(px) — 이보다 좁아지면 셀이 깨진다.
const COL_MAX_W = 640;  // 최대 폭(px) — 과도하게 늘어나 화면을 벗어나는 것 방지.
const COL_WIDTHS_KEY = 'bigboard.trades.colWidths.v1';

function clampWidth(w) {
  if (!Number.isFinite(w)) return COL_MIN_W;
  return Math.min(COL_MAX_W, Math.max(COL_MIN_W, Math.round(w)));
}

// SSR/테스트 등 localStorage가 없거나 접근이 막힌 환경에서도 안전하게 동작.
function safeStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch { /* 접근 거부(private mode 등) */ }
  return null;
}

// 저장된 컬럼 폭 맵 { [헤더명]: px } 로드. 실패 시 빈 객체.
function loadColWidths() {
  const ls = safeStorage();
  if (!ls) return {};
  try {
    const raw = ls.getItem(COL_WIDTHS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

// 단일 컬럼 폭 저장(다른 컬럼 값은 보존). 저장 불가 환경이면 조용히 무시.
function saveColWidth(key, width) {
  const ls = safeStorage();
  if (!ls) return;
  try {
    const widths = loadColWidths();
    widths[key] = clampWidth(width);
    ls.setItem(COL_WIDTHS_KEY, JSON.stringify(widths));
  } catch { /* quota/거부 */ }
}

// mousemove/mouseup를 붙일 전역 타깃. 브라우저는 window, 없으면 null.
function dragTarget() {
  if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') return window;
  return null;
}

function applyColWidth(th, width) {
  const w = clampWidth(width);
  th.style.width = `${w}px`;
  th.style.minWidth = `${w}px`;
  th.style.maxWidth = `${w}px`;
}

function cell(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}

// 리사이즈 가능한 헤더 셀(th)에 드래그 핸들을 붙인다.
// key: 저장 키(헤더명), colWidths: 현재 렌더의 저장된 폭 맵.
function attachResizeHandle(th, key, colWidths) {
  th.className = th.className ? `${th.className} resizable` : 'resizable';
  if (colWidths[key] != null) applyColWidth(th, colWidths[key]);

  const handle = document.createElement('div');
  handle.className = 'col-resize-handle';
  handle.title = '드래그하여 컬럼 폭 조절';

  handle.addEventListener('mousedown', (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const target = dragTarget();
    const startX = e && e.clientX != null ? e.clientX : 0;
    const startW = th.style.width ? parseInt(th.style.width, 10) : (th.offsetWidth || COL_MIN_W * 2);
    handle.className = 'col-resize-handle active';

    const widthAt = (ev) => {
      const x = ev && ev.clientX != null ? ev.clientX : startX;
      return clampWidth(startW + (x - startX));
    };
    const onMove = (ev) => { applyColWidth(th, widthAt(ev)); };
    const onUp = (ev) => {
      const w = widthAt(ev);
      applyColWidth(th, w);
      saveColWidth(key, w);
      handle.className = 'col-resize-handle';
      if (target) {
        target.removeEventListener('mousemove', onMove);
        target.removeEventListener('mouseup', onUp);
      }
    };
    if (target) {
      target.addEventListener('mousemove', onMove);
      target.addEventListener('mouseup', onUp);
    }
  });

  th.appendChild(handle);
}

// thead 행 생성 — 보유일부터 리사이즈 핸들 부착.
function buildHeaderRow(colWidths) {
  const hr = document.createElement('tr');
  for (let i = 0; i < TABLE_HEADERS.length; i++) {
    const th = cell('th', TABLE_HEADERS[i]);
    if (i >= RESIZE_FROM_INDEX) attachResizeHandle(th, TABLE_HEADERS[i], colWidths);
    hr.appendChild(th);
  }
  return hr;
}

// 손익/수익률 값에 priceTone 색 클래스 적용한 td.
function pnlCell(value, fmt) {
  const tone = priceTone(value);
  const td = cell('td', fmt(value), `num ${tone}`);
  return td;
}

function fmtPnl(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return NA;
  const sign = n > 0 ? '+' : '';
  return sign + Math.round(n).toLocaleString('en-US');
}

function fmtReturnPct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return NA;
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

// 모든 날짜의 records를 평탄화.
function allRecords(days) {
  const recs = [];
  for (const day of Object.values(days ?? {})) {
    for (const r of day.records ?? []) recs.push(r);
  }
  return recs;
}

// 날짜 내림차순 정렬.
function sortedDates(days) {
  return Object.keys(days ?? {}).sort((a, b) => (a < b ? 1 : -1));
}

// 누적 통계 카드 (상단 요약).
function renderStatsCards(stats) {
  const wrap = document.createElement('div');
  wrap.className = 'trades-stats';

  const items = [
    { label: '매매횟수', value: String(stats.tradeCount) },
    { label: '승률', value: stats.tradeCount > 0 ? `${(stats.winRate * 100).toFixed(1)}%` : NA },
    { label: '누적손익', value: fmtPnl(stats.cumPnl), tone: priceTone(stats.cumPnl) },
    { label: '평균수익률', value: fmtReturnPct(stats.avgReturn), tone: priceTone(stats.avgReturn) },
  ];

  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'trades-stat-card';
    const lbl = cell('div', item.label, 'trades-stat-label');
    const val = cell('div', item.value, `trades-stat-value${item.tone ? ` ${item.tone}` : ''}`);
    card.append(lbl, val);
    wrap.appendChild(card);
  }

  return wrap;
}

// 붙여넣기 버튼 + 모달.
function renderPasteSection(date, handlers, getHistory, pickPrevClose) {
  const wrap = document.createElement('div');
  wrap.className = 'trades-paste-wrap';

  const btn = document.createElement('button');
  btn.className = 'trades-paste-btn';
  btn.textContent = '키움 당일매매 붙여넣기';
  wrap.appendChild(btn);

  const modal = document.createElement('div');
  modal.className = 'trades-paste-modal';
  modal.style.display = 'none';

  const overlay = document.createElement('div');
  overlay.className = 'trades-paste-overlay';
  overlay.style.display = 'none';

  const modalInner = document.createElement('div');
  modalInner.className = 'trades-paste-modal-inner';

  const title = cell('h3', '키움 당일매매 붙여넣기', 'trades-paste-title');
  const dateLbl = cell('label', '거래일자 (YYYY-MM-DD)', 'trades-paste-lbl');
  const dateInput = document.createElement('input');
  dateInput.type = 'text';
  dateInput.className = 'trades-paste-date';
  dateInput.placeholder = 'YYYY-MM-DD';
  // 오늘 날짜 기본값
  const today = new Date().toISOString().slice(0, 10);
  dateInput.value = date || today;

  const textareaLbl = cell('label', '클립보드 내용 붙여넣기', 'trades-paste-lbl');
  const textarea = document.createElement('textarea');
  textarea.className = 'trades-paste-textarea';
  textarea.placeholder = '키움 "당일매매" 탭에서 Ctrl+A → Ctrl+C 후 여기에 붙여넣기';
  textarea.rows = 8;

  const preview = document.createElement('div');
  preview.className = 'trades-paste-preview';

  const actions = document.createElement('div');
  actions.className = 'trades-paste-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '취소';
  cancelBtn.className = 'ghost';
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '저장';
  saveBtn.className = 'trades-paste-save';
  saveBtn.disabled = true;
  actions.append(cancelBtn, saveBtn);

  modalInner.append(title, dateLbl, dateInput, textareaLbl, textarea, preview, actions);
  overlay.appendChild(modalInner);

  const open = () => {
    overlay.style.display = 'flex';
    textarea.value = '';
    preview.innerHTML = '';
    saveBtn.disabled = true;
  };
  const close = () => { overlay.style.display = 'none'; };

  btn.addEventListener('click', open);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  let parsedRecords = [];

  textarea.addEventListener('input', () => {
    const text = textarea.value;
    const records = parseKiwoomClipboard(text);
    parsedRecords = records;
    preview.innerHTML = '';
    if (!records.length) {
      saveBtn.disabled = true;
      preview.appendChild(cell('p', '파싱된 행 없음 — 키움 당일매매 탭 전체를 복사했는지 확인하세요.', 'trades-paste-msg'));
      return;
    }
    const tbl = document.createElement('table');
    tbl.className = 'trades-preview-table';
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const h of ['코드', '종목명', '매수평균', '매도평균', '수량', '손익', '수익률']) {
      hr.appendChild(cell('th', h));
    }
    thead.appendChild(hr);
    tbl.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const r of records) {
      const tr = document.createElement('tr');
      tr.appendChild(cell('td', r.code, 'code'));
      tr.appendChild(cell('td', r.name));
      tr.appendChild(cell('td', fmtPrice(r.buyAvg, 'KR'), 'num'));
      tr.appendChild(cell('td', fmtPrice(r.sellAvg, 'KR'), 'num'));
      tr.appendChild(cell('td', r.qty !== null ? String(r.qty) : NA, 'num'));
      tr.appendChild(pnlCell(r.pnl, fmtPnl));
      tr.appendChild(pnlCell(r.returnPct, fmtReturnPct));
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    preview.appendChild(cell('p', `${records.length}건 파싱됨 — 전날종가 조회 중…`, 'trades-paste-msg'));
    preview.appendChild(tbl);
    saveBtn.disabled = false;

    // 비차단 prevClose enrich — getHistory/pickPrevClose가 주입된 경우만
    if (typeof getHistory === 'function' && typeof pickPrevClose === 'function') {
      const tradeDate = dateInput.value.trim();
      Promise.allSettled(
        records.map((r) =>
          getHistory('KR', r.code, '3mo').then((candles) => {
            r.prevClose = pickPrevClose(candles, tradeDate);
          }).catch(() => { r.prevClose = null; })
        )
      ).then(() => {
        const msg = preview.querySelector('.trades-paste-msg');
        if (msg) msg.textContent = `${records.length}건 파싱됨`;
      });
    }
  });

  saveBtn.addEventListener('click', async () => {
    const tradeDate = dateInput.value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
      alert('날짜 형식이 올바르지 않습니다 (YYYY-MM-DD).');
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중…';
    try {
      await handlers?.onPaste?.(tradeDate, parsedRecords);
      close();
    } catch (e) {
      alert(`저장 실패: ${e.message}`);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '저장';
    }
  });

  wrap.appendChild(overlay);
  return wrap;
}

// 날짜 결과 태그 값 → 표시 텍스트.
const RESULT_TAG_OPTIONS = [
  { value: '', label: '없음' },
  { value: 'success', label: '성공' },
  { value: 'failure', label: '실패' },
];

// 날짜 옆 성공/실패 태그 선택 컨트롤(select). 현재 선택값에 따라 pill 색을 입힌다.
// 변경 시 handlers.onResultTag(date, value) 호출.
function renderResultTag(date, current, handlers) {
  const value = current === 'success' || current === 'failure' ? current : '';
  const select = document.createElement('select');
  const applyClass = (v) => {
    select.className = `trades-result-tag${v ? ` ${v}` : ''}`;
  };
  applyClass(value);
  select.title = '이 날짜의 매매 성공/실패 표시';
  for (const opt of RESULT_TAG_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === value) o.selected = true;
    select.appendChild(o);
  }
  select.value = value;
  select.addEventListener('change', () => {
    const v = select.value === 'success' || select.value === 'failure' ? select.value : '';
    applyClass(v);
    handlers?.onResultTag?.(date, v);
  });
  return select;
}

// 날짜별 테이블 (최신순).
function renderDayTable(date, dayData, handlers, colWidths = {}) {
  const section = document.createElement('section');
  section.className = 'trades-day';

  const head = document.createElement('div');
  head.className = 'trades-day-head';
  head.appendChild(cell('h3', date, 'trades-day-date'));
  head.appendChild(renderResultTag(date, dayData?.resultTag, handlers));
  section.appendChild(head);

  const records = dayData?.records ?? [];
  if (records.length) {
    const tbl = document.createElement('table');
    tbl.className = 'trades-table';

    const thead = document.createElement('thead');
    thead.appendChild(buildHeaderRow(colWidths));
    tbl.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const r of records) {
      const tr = document.createElement('tr');
      tr.appendChild(cell('td', r.code, 'code'));
      tr.appendChild(cell('td', r.name, 'name'));
      tr.appendChild(cell('td', fmtPrice(r.buyAvg, 'KR'), 'num'));
      tr.appendChild(cell('td', fmtPrice(r.sellAvg, 'KR'), 'num'));
      tr.appendChild(cell('td', r.qty !== null && r.qty !== undefined ? String(r.qty) : NA, 'num'));
      tr.appendChild(pnlCell(r.pnl, fmtPnl));
      tr.appendChild(pnlCell(r.returnPct, fmtReturnPct));
      tr.appendChild(cell('td', r.prevClose !== null && r.prevClose !== undefined ? fmtPrice(r.prevClose, 'KR') : NA, 'num'));

      // 보유일: 인라인 편집 가능 숫자 입력
      const holdTd = document.createElement('td');
      holdTd.className = 'manual';
      const holdInput = document.createElement('input');
      holdInput.type = 'number';
      holdInput.min = '0';
      holdInput.className = 'manual-input';
      holdInput.value = String(r.holdDays ?? 0);
      holdInput.addEventListener('change', () => {
        const v = Math.max(0, parseInt(holdInput.value, 10) || 0);
        holdInput.value = String(v);
        handlers?.onManual?.(date, r.code, { holdDays: v });
      });
      holdTd.appendChild(holdInput);
      tr.appendChild(holdTd);

      // 매매이유: 인라인 텍스트 입력
      const reasonTd = document.createElement('td');
      reasonTd.className = 'manual';
      const reasonInput = document.createElement('input');
      reasonInput.type = 'text';
      reasonInput.className = 'manual-input';
      reasonInput.value = r.reason ?? '';
      reasonInput.placeholder = '매매이유';
      reasonInput.addEventListener('change', () => {
        handlers?.onManual?.(date, r.code, { reason: reasonInput.value });
      });
      reasonTd.appendChild(reasonInput);
      tr.appendChild(reasonTd);

      // 테마태그: 쉼표 구분 입력 → 배열로 변환
      const tagsTd = document.createElement('td');
      tagsTd.className = 'manual';
      const tagsInput = document.createElement('input');
      tagsInput.type = 'text';
      tagsInput.className = 'manual-input';
      tagsInput.value = (r.tags ?? []).join(', ');
      tagsInput.placeholder = '태그1, 태그2';
      tagsInput.addEventListener('change', () => {
        const tags = tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean);
        handlers?.onManual?.(date, r.code, { tags });
      });
      tagsTd.appendChild(tagsInput);
      tr.appendChild(tagsTd);

      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    section.appendChild(tbl);
  } else {
    section.appendChild(cell('p', '이 날짜의 매매기록이 없습니다.', 'trades-empty'));
  }

  // 날짜별 일지 textarea
  const journalWrap = document.createElement('div');
  journalWrap.className = 'trades-journal-wrap';
  journalWrap.appendChild(cell('label', '일지', 'trades-journal-lbl'));
  const journalArea = document.createElement('textarea');
  journalArea.className = 'trades-journal';
  journalArea.placeholder = '오늘의 매매 소감/반성…';
  journalArea.rows = 3;
  journalArea.value = dayData?.journal ?? '';
  journalArea.addEventListener('change', () => {
    handlers?.onJournal?.(date, journalArea.value);
  });
  journalWrap.appendChild(journalArea);
  section.appendChild(journalWrap);

  return section;
}

/**
 * renderTrades(container, state, handlers, { getHistory, pickPrevClose })
 * container: DOM 요소
 * state: { data: { days:{...}, updatedAt } | null }
 * handlers: { onPaste(date,records), onManual(date,code,manual), onJournal(date,journal), onResultTag(date,resultTag) }
 * deps: { getHistory, pickPrevClose } — 선택적 주입(비차단 enrich용)
 */
export function renderTrades(container, state, handlers, deps = {}) {
  container.innerHTML = '';

  const section = document.createElement('section');
  section.className = 'trades';

  // 제목
  const head = document.createElement('div');
  head.className = 'trades-head';
  head.appendChild(cell('h2', '매매기록', 'trades-title'));
  section.appendChild(head);

  const days = state?.data?.days ?? {};
  const records = allRecords(days);
  const stats = computeStats(records);
  const colWidths = loadColWidths(); // 저장된 컬럼 폭을 렌더당 1회 로드

  // 누적 통계 카드
  section.appendChild(renderStatsCards(stats));

  // 붙여넣기 버튼
  const latestDate = sortedDates(days)[0] || null;
  section.appendChild(renderPasteSection(latestDate, handlers, deps.getHistory, deps.pickPrevClose));

  // 데이터 없음 안내
  const dates = sortedDates(days);
  if (!dates.length) {
    section.appendChild(cell('p', '매매기록이 없습니다. 키움 당일매매를 붙여넣기하여 시작하세요.', 'trades-empty'));
    container.appendChild(section);
    return;
  }

  // 날짜별 테이블 (최신순)
  for (const date of dates) {
    section.appendChild(renderDayTable(date, days[date], handlers, colWidths));
  }

  container.appendChild(section);
}
