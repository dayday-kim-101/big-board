import { fmtWonKR } from './format.js';

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
function arrow(dir, value) {
  if (dir === 'RISING' || Number(value) > 0) return '▲';
  if (dir === 'FALLING' || Number(value) < 0) return '▼';
  return '─';
}
function tone(dir, value) {
  if (dir === 'RISING' || Number(value) > 0) return 'up';
  if (dir === 'FALLING' || Number(value) < 0) return 'down';
  return 'flat';
}
function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return fmtWonKR(n);
}

function indexCard(idx) {
  const cls = tone(idx.direction, idx.change);
  const card = el('article', undefined, `krm-index-card ${cls}`);
  card.appendChild(el('div', idx.name, 'krm-index-name'));
  const line = el('div', undefined, 'krm-index-line');
  line.appendChild(el('strong', fmtNum(idx.closePrice), 'krm-index-price'));
  line.appendChild(el('span', `${arrow(idx.direction, idx.change)} ${fmtNum(Math.abs(Number(idx.change) || 0))} ${fmtSigned(idx.changePct)}%`, `krm-index-change ${cls}`));
  card.appendChild(line);
  return card;
}

function marketRow(m) {
  const row = el('div', undefined, 'krm-market-row');
  const b = m.breadth || {};
  const i = m.investor || {};
  row.appendChild(el('strong', m.label, 'krm-market-label'));
  row.appendChild(el('span', `상승 ${b.upCount ?? 0} · 하락 ${b.downCount ?? 0} · 보합 ${b.flatCount ?? 0}`, 'krm-breadth'));
  row.appendChild(el('span', `개인 ${fmtMoney(i.personal)} · 외국인 ${fmtMoney(i.foreign)} · 기관 ${fmtMoney(i.institution)}`, 'krm-investor'));
  return row;
}

export function renderKoreaMarket(container, { report = null, onMemo } = {}) {
  container.innerHTML = '';
  const section = el('section', undefined, 'korea-market');
  const head = el('div', undefined, 'krm-head');
  head.appendChild(el('h2', '전일 한국증시 메모', 'krm-title'));
  head.appendChild(el('span', report?.date ? `${report.date} 장마감 기준` : '데이터 없음', 'krm-date'));
  section.appendChild(head);

  if (!report) {
    section.appendChild(el('p', '국내증시 데이터를 불러오지 못했습니다.', 'krm-empty'));
    container.appendChild(section);
    return;
  }

  const indices = el('div', undefined, 'krm-index-grid');
  for (const idx of report.indices || []) indices.appendChild(indexCard(idx));
  section.appendChild(indices);

  const markets = el('div', undefined, 'krm-market-box');
  markets.appendChild(el('h3', '상승·하락 종목 수 / 투자자 수급', 'krm-subtitle'));
  for (const m of report.markets || []) markets.appendChild(marketRow(m));
  section.appendChild(markets);

  const foreign = el('div', undefined, 'krm-foreign-box');
  foreign.appendChild(el('h3', '외국인 순매수 상위 3종목', 'krm-subtitle'));
  const ol = el('ol', undefined, 'krm-foreign-list');
  for (const r of report.foreignerTop || []) {
    const li = el('li', undefined, 'krm-foreign-item');
    li.append(el('span', `${r.name} (${r.code})`, 'krm-foreign-name'), el('span', fmtMoney(r.netBuyAmount), 'krm-foreign-amt'));
    ol.appendChild(li);
  }
  foreign.appendChild(ol);
  section.appendChild(foreign);

  const memo = el('div', undefined, 'krm-memo-box');
  memo.appendChild(el('label', '한줄메모', 'krm-memo-label'));
  const input = document.createElement('textarea');
  input.className = 'krm-memo-input';
  input.rows = 2;
  input.maxLength = 1000;
  input.placeholder = '예: 지수 급반등이나 외국인 수급이 특정 대형주에 집중됨';
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

  const source = el('p', '출처: 네이버 국내지수 API, 네이버 전종목 시세, 네이버 투자자별 매매동향/외국인 매매상위', 'krm-source');
  section.appendChild(source);
  container.appendChild(section);
}
