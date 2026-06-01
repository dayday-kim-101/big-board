// 진입·상태·그룹/종목 관리·새로고침 오케스트레이션.
import { getList, putList, getQuotes, getSnapshot } from './api.js';
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

  // 종목 추가 폼
  const form = document.createElement('form');
  form.className = 'add-ticker';
  const market = document.createElement('select');
  for (const m of ['KR', 'US']) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    market.appendChild(opt);
  }
  const codeIn = document.createElement('input');
  codeIn.placeholder = '코드 (예: 005930 / AAPL)';
  codeIn.required = true;
  const nameIn = document.createElement('input');
  nameIn.placeholder = '이름 (선택)';
  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.textContent = '+ 종목';
  form.append(market, codeIn, nameIn, addBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    addTicker(g, market.value, codeIn.value.trim(), nameIn.value.trim());
    codeIn.value = '';
    nameIn.value = '';
    codeIn.focus();
  });

  bar.append(rename, del, form);
  return bar;
}

function paintBoard() {
  const root = document.getElementById('board-root');
  if (!root) return;
  const g = activeGroup();
  const merged = g ? mergeBoard({ groups: [g] }, state.quotes)[0] : null;
  renderBoard(root, merged, { onRemove: (row) => removeTicker(g, row) });
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
