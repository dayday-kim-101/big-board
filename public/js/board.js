// 전광판 격자 렌더링 (DOM). 안전을 위해 textContent 사용.
import { priceTone, fmtPrice, fmtSigned, fmtPct, fmtVolume, fmtTradingValue } from './format.js';

const COLS = ['종목', '현재가', '등락', '등락률', '거래량', '거래대금'];

function cell(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}

// group: {id, name, rows:[{market, code, name, quote}]}
// onRemove(ticker): 종목 삭제 콜백 (옵션). 없으면 삭제 버튼 미표시.
// onChart(ticker): 차트 열기 콜백 (옵션). 있으면 종목명이 클릭 가능.
export function renderBoard(container, group, { onRemove, onChart } = {}) {
  container.innerHTML = '';

  if (!group) {
    container.appendChild(cell('p', '그룹을 선택하거나 새로 만들어 종목을 추가하세요.', 'empty'));
    return;
  }
  if (!group.rows.length) {
    container.appendChild(cell('p', `"${group.name}" 그룹에 종목이 없습니다. 종목을 추가해 보세요.`, 'empty'));
    return;
  }

  const table = document.createElement('table');
  table.className = 'board';

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const c of COLS) htr.appendChild(cell('th', c));
  if (onRemove) htr.appendChild(cell('th', ''));
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of group.rows) {
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

    tr.appendChild(cell('td', fmtPrice(q?.price, row.market), 'num price'));
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

    if (onRemove) {
      const td = cell('td', undefined, 'actions');
      const btn = cell('button', '✕', 'remove');
      btn.title = '종목 삭제';
      btn.addEventListener('click', () => onRemove(row));
      td.appendChild(btn);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);
}
