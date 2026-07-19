import { KIWOOM_MOCK_SCENARIOS, runKiwoomMock } from './kiwoom-mock-core.js';

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function field(label, input, help) {
  const wrap = el('label', undefined, 'km-field');
  wrap.appendChild(el('span', label, 'km-label'));
  wrap.appendChild(input);
  if (help) wrap.appendChild(el('small', help, 'km-help'));
  return wrap;
}

function numberInput(value, placeholder) {
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'numeric';
  input.min = '0';
  input.step = '1';
  input.value = value ?? '';
  input.placeholder = placeholder || '';
  return input;
}

function makeScenarioSelect() {
  const select = document.createElement('select');
  for (const s of KIWOOM_MOCK_SCENARIOS) {
    const option = document.createElement('option');
    option.value = s.key;
    option.textContent = s.label;
    option.title = s.hint;
    select.appendChild(option);
  }
  return select;
}

function appendSearchBox(root, state, searchTickers, onPick) {
  const wrap = el('div', undefined, 'km-search');
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = '종목명/코드 검색 — 삼성, 하이닉스, 005930';
  input.autocomplete = 'off';
  const results = el('div', undefined, 'km-search-results');
  results.style.display = 'none';
  const selected = el('div', '선택된 종목 없음', 'km-selected-stock');

  const close = () => {
    results.innerHTML = '';
    results.style.display = 'none';
  };
  const renderResults = (items) => {
    results.innerHTML = '';
    if (!items.length) {
      results.appendChild(el('div', '검색 결과 없음', 'km-search-empty'));
      results.style.display = 'block';
      return;
    }
    const krItems = items.filter((x) => x.market === 'KR').slice(0, 8);
    if (!krItems.length) {
      results.appendChild(el('div', '키움 Mock 테스트는 국내(KR) 종목만 선택할 수 있습니다.', 'km-search-empty'));
      results.style.display = 'block';
      return;
    }
    for (const item of krItems) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'km-search-item';
      btn.append(el('strong', item.name), el('span', `${item.code} · ${item.market}${item.sub ? ' · ' + item.sub : ''}`));
      btn.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        state.stock = { market: item.market, code: item.code, name: item.name };
        selected.textContent = `${item.name} · ${item.code}`;
        input.value = '';
        close();
        onPick?.(item);
      });
      results.appendChild(btn);
    }
    results.style.display = 'block';
  };

  let timer = null;
  let reqId = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) return close();
    timer = setTimeout(async () => {
      const id = ++reqId;
      const items = await searchTickers(q);
      if (id === reqId) renderResults(items);
    }, 250);
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  wrap.append(field('종목 검색', input, '검색 결과에서 직접 선택해야 테스트 조건에 들어갑니다.'), selected, results);
  root.appendChild(wrap);
}

function resultTable(result) {
  const wrap = el('div', undefined, 'km-result-card');
  wrap.appendChild(el('h3', 'Mock 주문 결과', 'km-result-title'));
  if (!result.ok) {
    const ul = el('ul', undefined, 'km-errors');
    for (const msg of result.errors) ul.appendChild(el('li', msg));
    wrap.appendChild(ul);
    return wrap;
  }

  const summary = el('div', undefined, 'km-summary');
  const rows = [
    ['매수 완료', result.summary.buyComplete ? '예' : '아니오'],
    ['매도 완료', result.summary.sellComplete ? '예' : '아니오'],
    ['매수 체결수량', `${result.summary.filledBuyQty}주`],
    ['매도 체결수량', `${result.summary.filledSellQty}주`],
    ['접수 주문', `${result.summary.submittedCount}건`],
    ['취소 주문', `${result.summary.canceledCount}건`],
    ['차단 주문', `${result.summary.blockedCount}건`],
  ];
  for (const [k, v] of rows) {
    const box = el('div', undefined, 'km-summary-item');
    box.append(el('span', k), el('strong', v));
    summary.appendChild(box);
  }
  wrap.appendChild(summary);

  const orders = document.createElement('table');
  orders.className = 'km-orders';
  orders.innerHTML = '<thead><tr><th>주문ID</th><th>구분</th><th>가격</th><th>수량</th><th>체결</th><th>상태</th></tr></thead>';
  const tbody = document.createElement('tbody');
  for (const o of result.orders) {
    const tr = document.createElement('tr');
    for (const v of [o.orderId, o.side === 'BUY' ? '매수' : '매도', o.price.toLocaleString('ko-KR'), `${o.quantity}주`, `${o.filledQuantity}주`, o.status]) {
      tr.appendChild(el('td', v));
    }
    tbody.appendChild(tr);
  }
  if (!result.orders.length) {
    const tr = document.createElement('tr');
    const td = el('td', '접수된 주문 없음');
    td.colSpan = 6;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  orders.appendChild(tbody);
  wrap.appendChild(orders);

  const timeline = el('ol', undefined, 'km-timeline');
  for (const item of result.timeline) {
    const li = el('li', item.text, `km-step km-${item.level}`);
    timeline.appendChild(li);
  }
  wrap.append(el('h4', '실행 로그', 'km-subtitle'), timeline);
  return wrap;
}

function planSummary(state, form) {
  const sideText = [];
  if (form.buyEnabled.checked) sideText.push(`매수 ${Number(form.buyPrice.value || 0).toLocaleString('ko-KR')}원 × ${form.buyQty.value || 0}주`);
  if (form.sellEnabled.checked) sideText.push(`매도 ${Number(form.sellPrice.value || 0).toLocaleString('ko-KR')}원 × ${form.sellQty.value || 0}주`);
  return `${state.stock?.name || '종목 미선택'} · ${sideText.join(' / ') || '조건 없음'} · ${form.scenario.options[form.scenario.selectedIndex]?.textContent || ''}`;
}

export function renderKiwoomMock(container, { searchTickers }) {
  const state = { stock: null, saved: [] };
  container.innerHTML = '';
  const section = el('section', undefined, 'kiwoom-mock');
  section.appendChild(el('h2', '키움 Mock 테스트', 'km-title'));
  section.appendChild(el('p', '실제 주문 없이 종목/매수·매도 조건을 선택해서 가격 감시형 주문 집행 흐름을 검증합니다.', 'km-desc'));

  const form = document.createElement('form');
  form.className = 'km-form';
  appendSearchBox(form, state, searchTickers);

  const sideGrid = el('div', undefined, 'km-side-grid');
  const buyEnabled = document.createElement('input');
  buyEnabled.type = 'checkbox';
  buyEnabled.checked = true;
  const sellEnabled = document.createElement('input');
  sellEnabled.type = 'checkbox';
  sellEnabled.checked = true;

  const buyCard = el('div', undefined, 'km-side-card buy');
  const buyHead = el('label', undefined, 'km-check');
  buyHead.append(buyEnabled, el('strong', '매수 조건'));
  const buyPrice = numberInput('', '예: 70000');
  const buyQty = numberInput('1', '예: 5');
  buyCard.append(buyHead, field('매수가', buyPrice), field('매수개수', buyQty));

  const sellCard = el('div', undefined, 'km-side-card sell');
  const sellHead = el('label', undefined, 'km-check');
  sellHead.append(sellEnabled, el('strong', '매도 조건'));
  const sellPrice = numberInput('', '예: 73000');
  const sellQty = numberInput('1', '예: 5');
  sellCard.append(sellHead, field('매도가', sellPrice), field('매도개수', sellQty));
  sideGrid.append(buyCard, sellCard);
  form.appendChild(sideGrid);

  const opts = el('div', undefined, 'km-options');
  const scenario = makeScenarioSelect();
  const timeout = numberInput('5', '5');
  const maxAmount = numberInput('10000000', '10000000');
  opts.append(
    field('테스트 시나리오', scenario),
    field('미체결 취소시간(초)', timeout),
    field('주문 1건 최대금액', maxAmount, '안전장치 테스트용')
  );
  form.appendChild(opts);

  const actions = el('div', undefined, 'km-actions');
  const addBtn = el('button', '＋ 조건 추가', 'ghost');
  addBtn.type = 'button';
  const runBtn = el('button', 'Mock 테스트 실행', 'primary');
  runBtn.type = 'submit';
  actions.append(addBtn, runBtn);
  form.appendChild(actions);

  const savedBox = el('div', undefined, 'km-saved');
  const resultRoot = el('div', undefined, 'km-result');

  const controls = { buyEnabled, sellEnabled, buyPrice, buyQty, sellPrice, sellQty, scenario, timeout, maxAmount };
  const currentInput = () => ({
    market: state.stock?.market,
    symbol: state.stock?.code,
    name: state.stock?.name,
    buyEnabled: buyEnabled.checked,
    buyPrice: buyPrice.value,
    buyQuantity: buyQty.value,
    sellEnabled: sellEnabled.checked,
    sellPrice: sellPrice.value,
    sellQuantity: sellQty.value,
    scenario: scenario.value,
    unfilledTimeoutSec: timeout.value,
    maxOrderAmountKrw: maxAmount.value,
  });
  const renderSaved = () => {
    savedBox.innerHTML = '';
    if (!state.saved.length) {
      savedBox.appendChild(el('p', '추가한 조건이 없습니다. 위 입력폼으로 조건을 만들고 바로 실행하거나 여러 조건을 추가해 비교하세요.', 'km-empty'));
      return;
    }
    state.saved.forEach((item, idx) => {
      const card = el('div', undefined, 'km-condition');
      card.appendChild(el('span', `${idx + 1}. ${item.label}`));
      const run = el('button', '실행', 'ghost');
      run.type = 'button';
      run.addEventListener('click', () => {
        resultRoot.innerHTML = '';
        resultRoot.appendChild(resultTable(runKiwoomMock(item.input)));
      });
      const del = el('button', '삭제', 'ghost danger');
      del.type = 'button';
      del.addEventListener('click', () => { state.saved.splice(idx, 1); renderSaved(); });
      card.append(run, del);
      savedBox.appendChild(card);
    });
  };

  addBtn.addEventListener('click', () => {
    const input = currentInput();
    const preview = runKiwoomMock(input);
    if (!preview.ok) {
      resultRoot.innerHTML = '';
      resultRoot.appendChild(resultTable(preview));
      return;
    }
    state.saved.push({ input, label: planSummary(state, controls) });
    renderSaved();
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    resultRoot.innerHTML = '';
    resultRoot.appendChild(resultTable(runKiwoomMock(currentInput())));
  });

  section.append(form, el('h3', '추가한 조건', 'km-subtitle'), savedBox, resultRoot);
  container.appendChild(section);
  renderSaved();
}
