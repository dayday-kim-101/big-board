// 진입·상태·그룹/종목 관리·새로고침 오케스트레이션.
import { getList, putList, getQuotes, getSnapshot, searchTickers } from './api.js';
import { mergeBoard } from './format.js';
import { renderBoard } from './board.js';

const EMAIL_KEY = 'bigboard:email';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const state = {
  email: null,
  list: { groups: [], updatedAt: null },
  quotes: {},
  updatedAt: null,
  activeGroupId: null,
  loading: false,
};

const $app = () => document.getElementById('app');

function newGroupId() {
  return `g${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function activeGroup() {
  return state.list.groups.find((g) => g.id === state.activeGroupId) || state.list.groups[0] || null;
}

// ---------- 진입 화면 ----------

function renderGate(message) {
  const app = $app();
  app.innerHTML = '';
  const wrap = document.createElement('section');
  wrap.className = 'gate';
  wrap.innerHTML = `
    <h1>주식 전광판</h1>
    <p class="tagline">이메일을 입력하면 내 종목판이 어디서든 열립니다.</p>
  `;
  const form = document.createElement('form');
  const input = document.createElement('input');
  input.type = 'email';
  input.placeholder = 'you@example.com';
  input.required = true;
  input.autocomplete = 'email';
  const btn = document.createElement('button');
  btn.type = 'submit';
  btn.textContent = '내 전광판 열기';
  form.append(input, btn);
  if (message) {
    const err = document.createElement('p');
    err.className = 'gate-error';
    err.textContent = message;
    wrap.appendChild(err);
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = input.value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return renderGate('이메일 형식이 올바르지 않습니다.');
    localStorage.setItem(EMAIL_KEY, email);
    enterBoard(email);
  });
  wrap.appendChild(form);
  app.appendChild(wrap);
  input.focus();
}

// ---------- 보드 로드 ----------

async function enterBoard(email) {
  state.email = email;
  renderShell('불러오는 중…');
  try {
    const [list, snap] = await Promise.all([getList(email), getSnapshot()]);
    state.list = list && Array.isArray(list.groups) ? list : { groups: [], updatedAt: null };
    state.quotes = snap.quotes || {};
    state.updatedAt = snap.updatedAt;
    if (!state.activeGroupId && state.list.groups[0]) state.activeGroupId = state.list.groups[0].id;
    renderApp();
  } catch (e) {
    renderGate(`목록을 불러오지 못했습니다: ${e.message}`);
  }
}

function logout() {
  localStorage.removeItem(EMAIL_KEY);
  Object.assign(state, { email: null, list: { groups: [], updatedAt: null }, quotes: {}, activeGroupId: null });
  renderGate();
}

// ---------- 메인 렌더 ----------

function renderShell(statusText) {
  const app = $app();
  app.innerHTML = '';
  const header = document.createElement('header');
  header.className = 'topbar';
  header.innerHTML = `<strong class="brand">전광판</strong>`;
  const right = document.createElement('div');
  right.className = 'topbar-right';
  const status = document.createElement('span');
  status.className = 'status';
  status.textContent = statusText || '';
  right.appendChild(status);
  header.appendChild(right);
  app.appendChild(header);
  const main = document.createElement('div');
  main.id = 'board-root';
  app.appendChild(main);
}

function snapshotLabel() {
  if (!state.updatedAt) return '스냅샷 없음';
  const d = new Date(state.updatedAt);
  return `갱신: ${d.toLocaleString('ko-KR')}`;
}

function renderApp() {
  const app = $app();
  app.innerHTML = '';

  // 상단바
  const header = document.createElement('header');
  header.className = 'topbar';
  const brand = document.createElement('strong');
  brand.className = 'brand';
  brand.textContent = '전광판';
  const right = document.createElement('div');
  right.className = 'topbar-right';

  const stamp = document.createElement('span');
  stamp.className = 'status';
  stamp.textContent = snapshotLabel();

  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = state.loading ? '갱신 중…' : '↻ 새로고침';
  refreshBtn.disabled = state.loading;
  refreshBtn.className = 'refresh';
  refreshBtn.addEventListener('click', refresh);

  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = state.email;

  const out = document.createElement('button');
  out.textContent = '로그아웃';
  out.className = 'ghost';
  out.addEventListener('click', logout);

  right.append(stamp, refreshBtn, who, out);
  header.append(brand, right);
  app.appendChild(header);

  // 탭(그룹)
  app.appendChild(renderTabs());

  // 그룹 관리 + 종목 추가
  app.appendChild(renderControls());

  // 격자
  const boardRoot = document.createElement('div');
  boardRoot.id = 'board-root';
  app.appendChild(boardRoot);
  paintBoard();
}

function renderTabs() {
  const nav = document.createElement('nav');
  nav.className = 'tabs';
  for (const g of state.list.groups) {
    const tab = document.createElement('button');
    tab.className = 'tab' + (g.id === activeGroup()?.id ? ' active' : '');
    tab.textContent = `${g.name} (${g.tickers.length})`;
    tab.addEventListener('click', () => {
      state.activeGroupId = g.id;
      renderApp();
    });
    nav.appendChild(tab);
  }
  const add = document.createElement('button');
  add.className = 'tab add';
  add.textContent = '+ 그룹';
  add.addEventListener('click', addGroup);
  nav.appendChild(add);
  return nav;
}

function renderControls() {
  const bar = document.createElement('div');
  bar.className = 'controls';
  const g = activeGroup();
  if (!g) return bar;

  // 그룹 이름변경/삭제
  const rename = document.createElement('button');
  rename.className = 'ghost';
  rename.textContent = '그룹 이름변경';
  rename.addEventListener('click', () => renameGroup(g));
  const del = document.createElement('button');
  del.className = 'ghost danger';
  del.textContent = '그룹 삭제';
  del.addEventListener('click', () => deleteGroup(g));

  // 종목 검색 + 자동완성 (실제 검색 결과에서 선택해야만 추가 → 잘못된 코드 방지)
  bar.append(rename, del, renderTickerSearch(g));
  return bar;
}

// 검색 위젯: 디바운스 입력 → 드롭다운 결과, 선택 시에만 addTicker.
function renderTickerSearch(g) {
  const wrap = document.createElement('div');
  wrap.className = 'ticker-search';

  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = '종목 검색 (이름 또는 코드 — 예: 삼성, AAPL, 005930)';
  input.autocomplete = 'off';

  const results = document.createElement('div');
  results.className = 'search-results';
  results.style.display = 'none';

  const close = () => {
    results.innerHTML = '';
    results.style.display = 'none';
  };

  const pick = (r) => {
    close();
    input.value = '';
    addTicker(g, r.market, r.code, r.name); // 유효 종목만 들어옴
  };

  const render = (items) => {
    results.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = '검색 결과 없음';
      results.appendChild(empty);
      results.style.display = 'block';
      return;
    }
    for (const r of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'search-item';
      const badge = document.createElement('span');
      badge.className = `badge market-${r.market.toLowerCase()}`;
      badge.textContent = r.market;
      const name = document.createElement('span');
      name.className = 'search-name';
      name.textContent = r.name;
      const meta = document.createElement('span');
      meta.className = 'search-meta';
      meta.textContent = `${r.code}${r.sub ? ' · ' + r.sub : ''}`;
      row.append(badge, name, meta);
      // mousedown(클릭)이 input blur보다 먼저 처리되도록
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(r);
      });
      results.appendChild(row);
    }
    results.style.display = 'block';
  };

  let timer = null;
  let reqId = 0;
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (!q) return close();
    timer = setTimeout(async () => {
      const myId = ++reqId;
      const items = await searchTickers(q);
      if (myId === reqId && input.value.trim() === q) render(items); // 최신 요청만 반영
    }, 250);
  });
  input.addEventListener('blur', () => setTimeout(close, 150)); // 바깥 클릭 시 닫기

  wrap.append(input, results);
  return wrap;
}

function paintBoard() {
  const root = document.getElementById('board-root');
  if (!root) return;
  const g = activeGroup();
  const merged = g ? mergeBoard({ groups: [g] }, state.quotes)[0] : null;
  renderBoard(root, merged, {
    onRemove: (row) => removeTicker(g, row),
    onChart: (row) => openChart(row),
  });
}

// ---------- 차트 모달 (US=TradingView, KR=네이버 차트) ----------

function openChart(row) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'modal';

  const head = document.createElement('div');
  head.className = 'modal-head';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = `${row.name} · ${row.market} ${row.code}`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.title = '닫기';
  closeBtn.textContent = '✕';
  head.append(title, closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body';
  // US = TradingView 인터랙티브, KR = 네이버 차트 이미지(무료 임베드는 KRX 데이터 미제공).
  body.appendChild(row.market === 'US' ? usChart(row) : krChart(row));

  modal.append(head, body);
  overlay.appendChild(modal);

  const remove = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') remove();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) remove(); // 바깥 영역 클릭 시 닫기
  });
  closeBtn.addEventListener('click', remove);
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
}

// US: TradingView 인터랙티브 차트(심볼 자동 해석).
function usChart(row) {
  const frame = document.createElement('iframe');
  frame.className = 'chart-frame';
  frame.loading = 'lazy';
  const sym = encodeURIComponent(row.code);
  frame.src =
    `https://s.tradingview.com/widgetembed/?symbol=${sym}` +
    '&interval=D&theme=dark&style=1&locale=kr&timezone=America%2FNew_York' +
    '&withdateranges=1&hide_side_toolbar=0&allow_symbol_change=1&details=1';
  return frame;
}

// KR: 네이버 차트 이미지(일/주/월 토글) + 네이버 금융 링크.
function krChart(row) {
  const wrap = document.createElement('div');
  wrap.className = 'naver-chart';

  const tabs = document.createElement('div');
  tabs.className = 'chart-periods';

  const img = document.createElement('img');
  img.className = 'chart-img';
  img.alt = `${row.name} 차트`;
  const load = (p) => {
    img.src = `https://ssl.pstatic.net/imgfinance/chart/item/candle/${p}/${row.code}.png?t=${Date.now()}`;
  };

  for (const [p, label] of [['day', '일'], ['week', '주'], ['month', '월']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chart-period';
    b.textContent = label;
    b.addEventListener('click', () => {
      tabs.querySelectorAll('.chart-period').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      load(p);
    });
    tabs.appendChild(b);
  }
  tabs.firstChild.classList.add('active');
  load('day');

  const link = document.createElement('a');
  link.href = `https://finance.naver.com/item/main.naver?code=${row.code}`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.className = 'chart-link';
  link.textContent = '네이버 금융에서 자세히 보기 ↗';

  wrap.append(tabs, img, link);
  return wrap;
}

// ---------- 그룹/종목 변경 (변경 후 저장) ----------

async function save(previous) {
  try {
    state.loading = true;
    const saved = await putList(state.email, state.list);
    state.list = saved;
    if (!activeGroup() && saved.groups[0]) state.activeGroupId = saved.groups[0].id;
    state.loading = false;
    renderApp();
  } catch (e) {
    state.loading = false;
    if (previous) state.list = previous; // 롤백
    renderApp();
    alert(`저장 실패 — 변경이 취소되었습니다.\n${e.message}`);
  }
}

function clone() {
  return JSON.parse(JSON.stringify(state.list));
}

function addGroup() {
  const name = prompt('새 그룹 이름', '관심');
  if (!name || !name.trim()) return;
  const prev = clone();
  const id = newGroupId();
  state.list.groups.push({ id, name: name.trim(), tickers: [] });
  state.activeGroupId = id;
  save(prev);
}

function renameGroup(g) {
  const name = prompt('그룹 이름', g.name);
  if (!name || !name.trim()) return;
  const prev = clone();
  g.name = name.trim();
  save(prev);
}

function deleteGroup(g) {
  if (!confirm(`"${g.name}" 그룹을 삭제할까요?`)) return;
  const prev = clone();
  state.list.groups = state.list.groups.filter((x) => x.id !== g.id);
  state.activeGroupId = state.list.groups[0]?.id || null;
  save(prev);
}

function addTicker(g, market, code, name) {
  if (!code) return;
  if (g.tickers.some((t) => t.market === market && t.code === code)) {
    alert('이미 추가된 종목입니다.');
    return;
  }
  const prev = clone();
  g.tickers.push({ market, code, name: name || code });
  save(prev);
}

function removeTicker(g, row) {
  const prev = clone();
  g.tickers = g.tickers.filter((t) => !(t.market === row.market && t.code === row.code));
  save(prev);
}

// ---------- 새로고침 (실시간 시세) ----------

async function refresh() {
  const g = activeGroup();
  if (!g || !g.tickers.length) return;
  state.loading = true;
  renderApp();
  try {
    const { updatedAt, quotes } = await getQuotes(g.tickers.map((t) => ({ market: t.market, code: t.code })));
    state.quotes = { ...state.quotes, ...quotes };
    state.updatedAt = updatedAt;
  } catch (e) {
    alert(`새로고침 실패: ${e.message}`);
  } finally {
    state.loading = false;
    renderApp();
  }
}

// ---------- 부트 ----------

function init() {
  const saved = localStorage.getItem(EMAIL_KEY);
  if (saved && EMAIL_RE.test(saved)) enterBoard(saved);
  else renderGate();
}

init();
