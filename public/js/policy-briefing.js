function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function fmtDateWithDow(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return date || '';
  const d = new Date(`${date}T00:00:00Z`);
  const dow = ['Sun.', 'Mon.', 'Tue.', 'Wed.', 'Thu.', 'Fri.', 'Sat.'][d.getUTCDay()] || '';
  return `${date}(${dow})`;
}

function sourceLink(source) {
  const a = el('a', source.label || '출처', 'policy-source-link');
  a.href = source.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

export function renderPolicyBriefing(container, { dates = [], selectedDate = null, report = null, onSelectDate } = {}) {
  container.innerHTML = '';
  const section = el('section', undefined, 'policy-briefing korea-market');
  const head = el('div', undefined, 'krm-head');
  head.appendChild(el('h2', '정책브리핑', 'krm-title'));
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
  head.appendChild(el('span', report?.date ? `${report.date} 브리핑` : '데이터 없음', 'krm-date'));
  section.appendChild(head);

  if (!report) {
    section.appendChild(el('p', '정책브리핑 데이터를 불러오지 못했습니다.', 'krm-empty'));
    container.appendChild(section);
    return;
  }

  const summary = el('div', undefined, 'policy-summary');
  summary.appendChild(el('strong', report.title || `일일 정책·투자 브리핑 — ${report.date}`, 'policy-title'));
  if (report.summary) summary.appendChild(el('p', report.summary, 'policy-summary-text'));
  section.appendChild(summary);

  const list = el('ol', undefined, 'policy-rank-list');
  for (const item of report.topIndustries || []) {
    const li = el('li', undefined, 'policy-rank-item');
    const title = el('div', undefined, 'policy-rank-title');
    title.appendChild(el('strong', item.name || `산업 ${item.rank}`, 'policy-industry'));
    if (item.score !== null && item.score !== undefined) title.appendChild(el('span', `${item.score}/100`, 'policy-score'));
    li.appendChild(title);
    if (item.reason) li.appendChild(el('p', `이유: ${item.reason}`, 'policy-line'));
    if (item.koreaConnection) li.appendChild(el('p', `한국 연결: ${item.koreaConnection}`, 'policy-line policy-korea'));
    list.appendChild(li);
  }
  section.appendChild(list);

  const changes = el('div', undefined, 'policy-box');
  changes.appendChild(el('h3', '오늘의 핵심 변화', 'krm-subtitle'));
  const bullets = el('ul', undefined, 'policy-bullets');
  for (const [label, value] of [['미국', report.changes?.us], ['글로벌', report.changes?.global], ['국내', report.changes?.korea]]) {
    if (!value) continue;
    bullets.appendChild(el('li', `${label}: ${value}`, 'policy-bullet'));
  }
  changes.appendChild(bullets);
  section.appendChild(changes);

  if (report.risks?.length) {
    const risks = el('div', undefined, 'policy-box');
    risks.appendChild(el('h3', '주의할 리스크', 'krm-subtitle'));
    const ul = el('ul', undefined, 'policy-bullets');
    for (const risk of report.risks) ul.appendChild(el('li', risk, 'policy-bullet'));
    risks.appendChild(ul);
    section.appendChild(risks);
  }

  if (report.sources?.length) {
    const sources = el('p', undefined, 'policy-sources krm-source');
    sources.appendChild(el('span', '참고: '));
    report.sources.forEach((s, i) => {
      if (i) sources.appendChild(el('span', ', '));
      sources.appendChild(sourceLink(s));
    });
    section.appendChild(sources);
  }

  container.appendChild(section);
}
