// 전광판 격자 렌더링 (DOM). 안전을 위해 textContent 사용.
import { priceTone, fmtPrice, fmtSigned, fmtPct, fmtVolume, fmtTradingValue } from './format.js';

const COLS = ['종목', '현재가', '등락', '등락률', '거래량', '거래대금'];

function cell(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}

function addClass(el, cls) {
  const parts = new Set(String(el.className || '').split(/\s+/).filter(Boolean));
  parts.add(cls);
  el.className = [...parts].join(' ');
}

function removeClass(el, cls) {
  el.className = String(el.className || '').split(/\s+/).filter((x) => x && x !== cls).join(' ');
}

// 행 공통 액션 버튼: 드래그 핸들 + 삭제(onRemove).
function actionButtons(row, i, onRemove, draggable) {
  const wrap = document.createElement('div');
  wrap.className = 'actions';
  if (draggable) {
    const handle = cell('span', '↕', 'drag-handle');
    handle.title = '드래그해서 순서 변경';
    wrap.appendChild(handle);
  }
  if (onRemove) {
    const btn = cell('button', '✕', 'remove');
    btn.type = 'button';
    btn.title = row.type === 'memo' ? '메모 삭제' : '종목 삭제';
    btn.addEventListener('click', () => onRemove(row, i));
    wrap.appendChild(btn);
  }
  return wrap;
}

function actionsCell(row, i, onRemove, draggable) {
  const td = cell('td', undefined, 'actions');
  for (const child of Array.from(actionButtons(row, i, onRemove, draggable).children)) {
    td.appendChild(child);
  }
  return td;
}

function makeDraggable(tr, i, onReorderRow) {
  if (!onReorderRow) return;
  tr.draggable = true;
  tr.addEventListener('dragstart', (ev) => {
    addClass(tr, 'dragging');
    ev.dataTransfer?.setData?.('text/plain', String(i));
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
  });
  tr.addEventListener('dragover', (ev) => {
    ev.preventDefault?.();
    addClass(tr, 'drag-over');
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
  });
  tr.addEventListener('dragleave', () => removeClass(tr, 'drag-over'));
  tr.addEventListener('drop', (ev) => {
    ev.preventDefault?.();
    removeClass(tr, 'drag-over');
    const from = Number(ev.dataTransfer?.getData?.('text/plain'));
    if (Number.isInteger(from) && from !== i) onReorderRow(from, i);
  });
  tr.addEventListener('dragend', () => {
    removeClass(tr, 'dragging');
    removeClass(tr, 'drag-over');
  });
}

// group: {id, name, rows:[{market, code, name, quote} | {type:'memo', id, text}]}
// onRemove(row, index): 행 삭제 콜백 (옵션). 없으면 삭제 버튼 미표시.
// onChart(ticker): 차트 열기 콜백 (옵션). 있으면 종목명·현재가가 클릭 가능.
// onReorderRow(fromIndex, toIndex): 드래그앤드랍 순서 변경 콜백 (옵션). 있으면 행 drag 가능.
// onEditMemo(row, index, text): memo row 텍스트 수정 콜백 (옵션). 있으면 inline input.
export function renderBoard(container, group, { onRemove, onChart, onReorderRow, onEditMemo } = {}) {
  container.innerHTML = '';

  if (!group) {
    container.appendChild(cell('p', '그룹을 선택하거나 새로 만들어 종목을 추가하세요.', 'empty'));
    return;
  }
  if (!group.rows.length) {
    container.appendChild(cell('p', `"${group.name}" 그룹에 종목이 없습니다. 종목을 추가해 보세요.`, 'empty'));
    return;
  }

  const showActions = Boolean(onRemove || onReorderRow);

  const table = document.createElement('table');
  table.className = 'board';

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const c of COLS) htr.appendChild(cell('th', c));
  if (showActions) htr.appendChild(cell('th', ''));
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const total = group.rows.length;
  group.rows.forEach((row, i) => {
    // memo row: 키움 관심종목의 빈칸메모처럼 quote 영역 전체를 차지하는 한 줄.
    // 실제 입력 영역은 전체 폭으로 펴고, CSS 배경으로 컬럼 구분선을 보여준다.
    if (row.type === 'memo') {
      const tr = document.createElement('tr');
      tr.className = 'board-row memo-row';
      makeDraggable(tr, i, onReorderRow);
      const td = cell('td', undefined, 'memo-cell memo-grid-cell');
      td.colSpan = COLS.length;
      const memoValue = row.text ?? '';
      if (onEditMemo) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'memo-input board-memo-input';
        input.placeholder = '메모 입력…';
        input.value = memoValue;
        let lastSavedValue = input.value;
        const commitMemo = () => {
          if (input.value === lastSavedValue) return;
          lastSavedValue = input.value;
          onEditMemo(row, i, input.value);
        };
        input.addEventListener('blur', commitMemo);
        input.addEventListener('keydown', (ev) => {
          if (ev.key !== 'Enter') return;
          ev.preventDefault?.();
          commitMemo();
          input.blur?.();
        });
        td.appendChild(input);
      } else {
        td.appendChild(cell('span', memoValue, 'memo-text board-memo-text'));
      }
      tr.appendChild(td);
      if (showActions) tr.appendChild(actionsCell(row, i, onRemove, Boolean(onReorderRow)));
      tbody.appendChild(tr);
      return;
    }

    const q = row.quote;
    const tone = priceTone(q?.change);
    const tr = document.createElement('tr');
    tr.className = `board-row tone-${tone}`;
    makeDraggable(tr, i, onReorderRow);

    // 종목명 + 코드/시장 (onChart 있으면 클릭 시 차트)
    const nameTd = cell('td', undefined, 'name');
    const nameInner = onChart ? cell('button', undefined, 'name-link') : cell('span', undefined, 'name-plain');
    if (onChart) {
      nameInner.type = 'button';
      nameInner.title = '차트 보기';
      nameInner.addEventListener('click', () => onChart(row));
    }
    nameInner.appendChild(cell('span', row.name, 'name-main'));
    nameInner.appendChild(cell('span', `${row.market} ${row.code}`, 'name-sub'));
    nameTd.appendChild(nameInner);
    tr.appendChild(nameTd);

    // 현재가 셀 (onChart 있으면 클릭 시 차트 — 종목명 클릭과 동일 동작)
    const priceTd = cell('td', undefined, 'num price');
    const priceText = fmtPrice(q?.price, row.market);
    if (onChart) {
      const priceBtn = cell('button', priceText, 'price-chart-btn');
      priceBtn.type = 'button';
      priceBtn.title = '차트 보기';
      priceBtn.addEventListener('click', () => onChart(row));
      priceTd.appendChild(priceBtn);
    } else {
      priceTd.textContent = priceText;
    }
    tr.appendChild(priceTd);
    tr.appendChild(cell('td', fmtSigned(q?.change, row.market), `num ${tone}`));
    tr.appendChild(cell('td', fmtPct(q?.changePct), `num ${tone}`));
    tr.appendChild(cell('td', fmtVolume(q?.volume), 'num'));

    // 거래대금 (US 근사면 * 표시)
    const tvText = fmtTradingValue(q?.tradingValue, row.market);
    const tvTd = cell('td', tvText, 'num');
    if (q?.approxTradingValue && q?.tradingValue != null) {
      const star = cell('sup', '*', 'approx');
      star.title = '근사값 (현재가 × 거래량)';
      tvTd.appendChild(star);
    }
    tr.appendChild(tvTd);

    if (showActions) tr.appendChild(actionsCell(row, i, onRemove, Boolean(onReorderRow)));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}
