function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function fmtNum(n, d = 2) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
}
function fmtSigned(n, d = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return `${x > 0 ? '+' : ''}${fmtNum(x, d)}`;
}
function tone(value) {
  if (Number(value) > 0) return 'up';
  if (Number(value) < 0) return 'down';
  return 'flat';
}
function arrow(value) {
  if (Number(value) > 0) return '▲';
  if (Number(value) < 0) return '▼';
  return '─';
}
function fmtDateWithDow(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return date || '';
  const d = new Date(`${date}T00:00:00Z`);
  const dow = ['Sun.', 'Mon.', 'Tue.', 'Wed.', 'Thu.', 'Fri.', 'Sat.'][d.getUTCDay()] || '';
  return `${date}(${dow})`;
}

function marketCard(item) {
  const cls = tone(item.changePct ?? item.change);
  const card = el('article', undefined, `usm-card ${cls}`);
  card.appendChild(el('div', item.label, 'usm-name'));
  const line = el('div', undefined, 'usm-line');
  const decimals = item.key === 'us10y' ? 3 : 2;
  const unit = item.unit || '';
  line.appendChild(el('strong', `${fmtNum(item.close, decimals)}${unit}`, 'usm-price'));
  line.appendChild(el('span', `${arrow(item.changePct)} ${fmtSigned(item.changePct)}%`, `usm-change ${cls}`));
  card.appendChild(line);
  if (item.date) card.appendChild(el('small', `기준일 ${item.date}`, 'usm-source-date'));
  return card;
}

function itemList(title, rows, emptyText) {
  const box = el('div', undefined, 'usm-sector-box');
  box.appendChild(el('h3', title, 'krm-subtitle'));
  if (!rows?.length) {
    box.appendChild(el('p', emptyText, 'krm-empty-small'));
    return box;
  }
  const ol = el('ol', undefined, 'usm-sector-list');
  for (const r of rows) {
    const li = el('li', undefined, 'usm-sector-item');
    const cls = tone(r.changePct);
    li.append(el('span', r.label, 'usm-sector-name'), el('span', `${fmtSigned(r.changePct)}%`, `usm-sector-pct ${cls}`));
    ol.appendChild(li);
  }
  box.appendChild(ol);
  return box;
}

export function renderUsMarket(container, { dates = [], selectedDate = null, report = null, onSelectDate, onMemo } = {}) {
  container.innerHTML = '';
  const section = el('section', undefined, 'us-market korea-market');
  const head = el('div', undefined, 'krm-head');
  head.appendChild(el('h2', '전일 미국증시 메모', 'krm-title'));
  const select = document.createElement('select');
  select.className = 'krm-date-select';
  if (!dates.length) {
    const opt = document.createElement('option');
    opt.textContent = '수집된 날짜 없음';
    select.appendChild(opt);
  } else {
    for (const d of dates) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = fmtDateWithDow(d);
      select.appendChild(opt);
    }
    select.value = selectedDate || report?.date || dates[0];
    select.addEventListener('change', () => onSelectDate?.(select.value));
  }
  head.appendChild(select);
  head.appendChild(el('span', report?.date ? `${report.date} 미국장 일봉 기준` : '데이터 없음', 'krm-date'));
  section.appendChild(head);

  if (!report) {
    section.appendChild(el('p', '미국증시 데이터를 불러오지 못했습니다.', 'krm-empty'));
    container.appendChild(section);
    return;
  }

  const indices = el('div', undefined, 'usm-grid usm-index-grid');
  for (const idx of report.indices || []) indices.appendChild(marketCard(idx));
  section.appendChild(indices);

  const focus = el('div', undefined, 'usm-grid usm-focus-grid');
  for (const item of [...(report.focus || []), ...(report.rates || [])]) focus.appendChild(marketCard(item));
  section.appendChild(focus);

  const sectors = el('div', undefined, 'usm-sectors');
  sectors.appendChild(itemList('상승 섹터', report.sectors?.rising || [], '상승 섹터 없음'));
  sectors.appendChild(itemList('하락 섹터', report.sectors?.falling || [], '하락 섹터 없음'));
  section.appendChild(sectors);

  const memo = el('div', undefined, 'krm-memo-box');
  memo.appendChild(el('label', '한줄메모', 'krm-memo-label'));
  const input = document.createElement('textarea');
  input.className = 'krm-memo-input';
  input.rows = 2;
  input.maxLength = 1000;
  input.placeholder = '예: 금리 하락과 반도체 강세가 나스닥을 지지, 러셀은 상대적으로 부진';
  input.value = report.memo || '';
  memo.appendChild(input);
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'krm-save';
  save.textContent = '메모 저장';
  save.addEventListener('click', async () => {
    const label = save.textContent;
    save.disabled = true;
    save.textContent = '저장 중…';
    const ok = await onMemo?.(report.date, input.value);
    save.disabled = false;
    save.textContent = ok === false ? '다시 저장' : label;
  });
  memo.appendChild(save);
  section.appendChild(memo);

  section.appendChild(el('p', '출처: Yahoo Finance 일봉. 날짜는 국내증시 메모 날짜와 동일하게 맞추며, 미국 휴장일은 직전 미국 거래일 데이터를 사용합니다. 섹터는 SPDR 섹터 ETF(XLK 등) 등락률 기준입니다.', 'krm-source'));
  container.appendChild(section);
}
