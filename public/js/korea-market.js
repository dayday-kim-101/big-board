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
function fmtTrillion(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${(n / 1_000_000_000_000).toFixed(2)}조`;
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
  row.appendChild(el('span', b.stockCount ? `상승 ${b.upCount ?? 0} · 하락 ${b.downCount ?? 0} · 보합 ${b.flatCount ?? 0}` : '상승/하락: 장마감 데이터 확인 전', 'krm-breadth'));
  row.appendChild(el('span', `개인 ${fmtTrillion(i.personal)} · 외국인 ${fmtTrillion(i.foreign)} · 기관 ${fmtTrillion(i.institution)}`, 'krm-investor'));
  return row;
}

function foreignerRankBlock(title, rows, amountKey = 'netBuyAmount') {
  const box = el('div', undefined, 'krm-foreign-box');
  box.appendChild(el('h3', title, 'krm-subtitle'));
  for (const market of ['KOSPI', 'KOSDAQ']) {
    const group = el('div', undefined, 'krm-foreign-market');
    group.appendChild(el('h4', market === 'KOSPI' ? '코스피' : '코스닥', 'krm-foreign-market-title'));
    const list = rows.filter((x) => x.market === market).slice(0, 5);
    if (!list.length) {
      group.appendChild(el('p', 'KRX 기준 데이터 미수집', 'krm-empty-small'));
    } else {
      const ol = el('ol', undefined, 'krm-foreign-list');
      for (const r of list) {
        const li = el('li', undefined, 'krm-foreign-item');
        li.append(el('span', `${r.name} (${r.code})`, 'krm-foreign-name'), el('span', fmtTrillion(r[amountKey] ?? r.netBuyAmount ?? r.netSellAmount), 'krm-foreign-amt'));
        ol.appendChild(li);
      }
      group.appendChild(ol);
    }
    box.appendChild(group);
  }
  return box;
}

function fmtDateWithDow(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return date || '';
  const d = new Date(`${date}T00:00:00+09:00`);
  const dow = ['Sun.', 'Mon.', 'Tue.', 'Wed.', 'Thu.', 'Fri.', 'Sat.'][d.getDay()] || '';
  return `${date}(${dow})`;
}

export function renderKoreaMarket(container, { dates = [], selectedDate = null, report = null, onSelectDate, onMemo } = {}) {
  container.innerHTML = '';
  const section = el('section', undefined, 'korea-market');
  const head = el('div', undefined, 'krm-head');
  head.appendChild(el('h2', '전일 한국증시 메모', 'krm-title'));
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
  head.appendChild(el('span', report?.date ? `${report.date} 20시 이후 장마감 기준` : '데이터 없음', 'krm-date'));
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

  section.appendChild(foreignerRankBlock('외국인 순매수금액 상위 종목', report.foreignerTop || [], 'netBuyAmount'));
  section.appendChild(foreignerRankBlock('외국인 순매도금액 상위 종목', report.foreignerSellTop || [], 'netSellAmount'));

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

  const source = el('p', '기준: 외국인 수급/종목순위는 KRX 장내거래 확정치 기준으로 수집 예정(현재 KRX 소스 미연결 시 미수집 표시). 지수/상승하락은 기존 국내지수·전종목 시세 기준.', 'krm-source');
  section.appendChild(source);
  container.appendChild(section);
}
