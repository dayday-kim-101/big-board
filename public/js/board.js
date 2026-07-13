// 전광판 격자 렌더링 (DOM). 안전을 위해 textContent 사용.
import { priceTone, fmtPrice, fmtSigned, fmtPct, fmtVolume, fmtTradingValue } from './format.js';

const COLS = ['종목', '현재가', '등락', '등락률', '거래량', '거래대금'];

function cell(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}

// 행 공통 액션 버튼: 위/아래 이동(onMoveRow) + 삭제(onRemove).
// 첫 행의 위, 마지막 행의 아래 버튼은 disabled.
function actionButtons(row, i, total, onRemove, onMoveRow) {
  const wrap = document.createElement('div');
  wrap.className = 'actions';
  if (onMoveRow) {
    const up = cell('button', '▲', 'move-up');
    up.type = 'button';
    up.title = '위로 이동';
    up.disabled = i === 0;
    up.addEventListener('click', () => onMoveRow(i, -1));
    wrap.appendChild(up);
    const down = cell('button', '▼', 'move-down');
    down.type = 'button';
    down.title = '아래로 이동';
    down.disabled = i === total - 1;
    down.addEventListener('click', () => onMoveRow(i, 1));
    wrap.appendChild(down);
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

function actionsCell(row, i, total, onRemove, onMoveRow) {
  const td = cell('td', undefined, 'actions');
  for (const child of Array.from(actionButtons(row, i, total, onRemove, onMoveRow).children)) {
    td.appendChild(child);
  }
  return td;
}

// group: {id, name, rows:[{market, code, name, quote} | {type:'memo', id, text}]}
// onRemove(row, index): 행 삭제 콜백 (옵션). 없으면 삭제 버튼 미표시.
// onChart(ticker): 차트 열기 콜백 (옵션). 있으면 종목명·현재가가 클릭 가능.
// onMoveRow(index, delta): 행 위/아래 이동 콜백 (옵션). 있으면 이동 버튼 표시.
// onEditMemo(row, index, text): memo row 텍스트 수정 콜백 (옵션). 있으면 inline input.
export function renderBoard(container, group, { onRemove, onChart, onMoveRow, onEditMemo } = {}) {
  container.innerHTML = '';

  if (!group) {
    container.appendChild(cell('p', '그룹을 선택하거나 새로 만들어 종목을 추가하세요.', 'empty'));
    return;
  }
  if (!group.rows.length) {
    container.appendChild(cell('p', `"${group.name}" 그룹에 종목이 없습니다. 종목을 추가해 보세요.`, 'empty'));
    return;
  }

  const showActions = Boolean(onRemove || onMoveRow);

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
    // memo row: 액션 열까지 포함해 한 행 전체를 채우는 메모 줄.
    if (row.type === 'memo') {
      const tr = document.createElement('tr');
      tr.className = 'memo-row';
      const td = cell('td', undefined, 'memo-cell');
      td.colSpan = COLS.length + (showActions ? 1 : 0);
      const line = document.createElement('div');
      line.className = 'board-memo-line';
      if (onEditMemo) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'memo-input board-memo-input';
        input.placeholder = '메모 입력…';
        input.value = row.text ?? '';
        input.addEventListener('change', () => onEditMemo(row, i, input.value));
        line.appendChild(input);
      } else {
        line.appendChild(cell('span', row.text ?? '', 'memo-text board-memo-text'));
      }
      if (showActions) line.appendChild(actionButtons(row, i, total, onRemove, onMoveRow));
      td.appendChild(line);
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    const q = row.quote;
    const tone = priceTone(q?.change);
    const tr = document.createElement('tr');
    tr.className = `tone-${tone}`;

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

    if (showActions) tr.appendChild(actionsCell(row, i, total, onRemove, onMoveRow));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}
