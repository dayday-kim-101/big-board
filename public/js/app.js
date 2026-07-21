// 진입·상태·그룹/종목 관리·새로고침 오케스트레이션.
import {
  getList, putList, getQuotes, getSnapshot, searchTickers, getHistory,
  getJaelyoDates, getJaelyo, putJaelyoManual, putJaelyoDailyTheme, getMacro, getSectors,
  getTrades, putTradesUpsert, putTradeManual, putTradesJournal, putTradesResultTag,
} from './api.js';
import { mergeBoard } from './format.js';
import { renderBoard } from './board.js';
import { renderJaelyo } from './jaelyo.js';
import { renderMacro } from './macro.js';
import { openMacroChart } from './macro-chart.js';
import { renderTrades } from './trades.js';
import { renderKiwoomMock } from './kiwoom-mock.js';
import { renderSectorMap } from './sectormap.js';
import { pickPrevClose } from './trades-core.js';

const EMAIL_KEY = 'bigboard:email';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const state = {
  email: null,
  list: { groups: [], updatedAt: null },
  quotes: {},
  updatedAt: null,
  activeGroupId: null,
  loading: false,
  jaelyo: { dates: [], selectedDate: null, board: null },
  macro: { data: null },
  trades: { data: null },
  sectorMap: { data: null, quotesRequested: false },
  bottomTab: 'jaelyo', // 전광판 아래 탭: 'jaelyo' | 'sectorMap' | 'macro' | 'crisis' | 'trades' | 'kiwoomMock'
};

const BOTTOM_TABS = [
  { key: 'jaelyo', label: '재료정리' },
  { key: 'sectorMap', label: '섹터맵' },
  { key: 'macro', label: '매크로 지표' },
  { key: 'crisis', label: '금융위기' },
  { key: 'trades', label: '매매기록' },
  { key: 'kiwoomMock', label: '키움 Mock' },
];

// 매크로 데이터(공용)를 탭별로 분류. category==='crisis'는 금융위기 탭, 그 외는 매크로 탭.
function indicatorsForTab(tab) {
  const all = Array.isArray(state.macro.data?.indicators) ? state.macro.data.indicators : [];
  const filtered = all.filter((i) => (tab === 'crisis' ? i.category === 'crisis' : i.category !== 'crisis'));
  return { ...state.macro.data, indicators: filtered };
}

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
    // 재료정리 보드 + 매크로 지표(공용) + 매매기록(개인) + 섹터맵 로드 — 실패해도 전광판은 표시.
    await Promise.allSettled([loadJaelyo(), loadMacro(), loadTrades(), loadSectorMap()]);
    renderApp();
  } catch (e) {
    renderGate(`목록을 불러오지 못했습니다: ${e.message}`);
  }
}

// ---------- 재료정리 보드 ----------

async function loadJaelyo() {
  const { dates, latest } = await getJaelyoDates();
  state.jaelyo.dates = dates;
  state.jaelyo.selectedDate = latest;
  state.jaelyo.board = latest ? await getJaelyo(latest) : null;
}

async function loadMacro() {
  state.macro.data = await getMacro();
}

async function loadTrades() {
  state.trades.data = await getTrades(state.email);
}

async function loadSectorMap() {
  state.sectorMap.data = await getSectors();
}

// 전광판 아래 탭바(재료정리 / 매크로 지표). 클릭 시 내용 영역만 교체.
function renderBottomTabs() {
  const nav = document.createElement('nav');
  nav.className = 'subtabs';
  for (const t of BOTTOM_TABS) {
    const b = document.createElement('button');
    b.className = 'subtab' + (state.bottomTab === t.key ? ' active' : '');
    b.textContent = t.label;
    b.addEventListener('click', () => {
      if (state.bottomTab === t.key) return;
      state.bottomTab = t.key;
      nav.querySelectorAll('.subtab').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      paintBottom();
    });
    nav.appendChild(b);
  }
  return nav;
}

function paintBottom() {
  if (state.bottomTab === 'macro' || state.bottomTab === 'crisis') paintMacroTab(state.bottomTab);
  else if (state.bottomTab === 'trades') paintTrades();
  else if (state.bottomTab === 'kiwoomMock') paintKiwoomMock();
  else if (state.bottomTab === 'sectorMap') paintSectorMap();
  else paintJaelyo();
}

function paintSectorMap() {
  const root = document.getElementById('bottom-content');
  if (!root) return;
  renderSectorMap(root, { sectors: state.sectorMap.data?.sectors ?? [], quotes: state.quotes });
  loadSectorQuotes();
}

// 섹터맵 종목 중 스냅샷에 시세가 없는 것만 최초 1회 조회해 병합. 완료되면 다시 그림.
async function loadSectorQuotes() {
  if (state.sectorMap.quotesRequested) return;
  const sectors = state.sectorMap.data?.sectors ?? [];
  const missing = [...new Set(sectors.flatMap((s) => s.companies.map((c) => c.code)))]
    .filter((code) => !state.quotes[`KR:${code}`])
    .map((code) => ({ market: 'KR', code }));
  if (!missing.length) return;
  state.sectorMap.quotesRequested = true;
  try {
    const { quotes } = await getQuotes(missing);
    state.quotes = { ...state.quotes, ...quotes };
    if (state.bottomTab === 'sectorMap') paintSectorMap();
  } catch {
    // 시세 조회 실패해도 섹터맵은 중립색으로 표시.
  }
}

function paintKiwoomMock() {
  const root = document.getElementById('bottom-content');
  if (!root) return;
  renderKiwoomMock(root, { searchTickers });
}

function paintTrades() {
  if (state.bottomTab !== 'trades') return;
  const root = document.getElementById('bottom-content');
  if (!root) return;
  renderTrades(root, state.trades, {
    onPaste: async (date, records) => {
      await putTradesUpsert(state.email, date, records);
      state.trades.data = await getTrades(state.email);
      paintTrades();
    },
    onManual: async (date, code, manual) => {
      try {
        await putTradeManual(state.email, date, code, manual);
        state.trades.data = await getTrades(state.email);
        paintTrades();
      } catch (e) {
        alert(`저장 실패 — 변경이 취소되었습니다.\n${e.message}`);
      }
    },
    onJournal: async (date, journal) => {
      try {
        await putTradesJournal(state.email, date, journal);
        state.trades.data = await getTrades(state.email);
        paintTrades();
      } catch (e) {
        alert(`일지 저장 실패 — 변경이 취소되었습니다.\n${e.message}`);
      }
    },
    onResultTag: async (date, resultTag) => {
      try {
        await putTradesResultTag(state.email, date, resultTag);
        state.trades.data = await getTrades(state.email);
        paintTrades();
      } catch (e) {
        alert(`태그 저장 실패 — 변경이 취소되었습니다.\n${e.message}`);
      }
    },
  }, { getHistory, pickPrevClose });
}

// 매크로/금융위기 탭은 같은 렌더(renderMacro)를 카테고리 필터만 달리해 공유.
function paintMacroTab(tab) {
  const root = document.getElementById('bottom-content');
  if (!root) return;
  renderMacro(root, { data: indicatorsForTab(tab), onOpenChart: openMacroChart });
}

function paintJaelyo() {
  if (state.bottomTab !== 'jaelyo') return; // 매크로 탭이면 재료정리 콜백 무시
  const root = document.getElementById('bottom-content');
  if (!root) return;
  renderJaelyo(root, {
    dates: state.jaelyo.dates,
    selectedDate: state.jaelyo.selectedDate,
    board: state.jaelyo.board,
    onSelectDate: selectJaelyoDate,
    onEditManual: editManual,
    onEditDailyTheme: editDailyTheme,
    onChart: (row) => openChart(row), // 현재가 클릭 → 차트 (재료정리는 한국 종목)
  });
}

// 빠른 날짜 전환 시 늦게 도착한 응답이 최신 선택을 덮어쓰지 않도록 요청 식별자로 가드.
let jaelyoReqId = 0;

async function selectJaelyoDate(date) {
  state.jaelyo.selectedDate = date;
  const myId = ++jaelyoReqId;
  let board;
  try {
    board = await getJaelyo(date);
  } catch (e) {
    if (myId === jaelyoReqId) alert(`보드 로드 실패: ${e.message}`);
    return;
  }
  if (myId !== jaelyoReqId) return; // 더 최신 선택이 이미 처리됨 — 무시
  state.jaelyo.board = board;
  paintJaelyo();
}

// 수동 필드 저장. 저장 성공 시 서버가 정규화한 보드로 갱신·재렌더(테이블/팝업 반영),
// 실패 시 직전 보드로 롤백·재렌더(app.js save() 패턴과 동일).
// 반환: 성공 true / 실패 false — 팝업이 성공 시에만 닫도록 결과를 알린다.
async function editManual(code, patch) {
  const date = state.jaelyo.selectedDate;
  if (!date) return false;
  const previous = state.jaelyo.board;
  try {
    state.jaelyo.board = await putJaelyoManual(date, code, patch);
    paintJaelyo(); // 서버 정규화 결과를 테이블에 반영
    return true;
  } catch (e) {
    state.jaelyo.board = previous; // 롤백
    paintJaelyo();
    alert(`저장 실패 — 변경이 취소되었습니다.\n${e.message}`);
    return false;
  }
}

async function editDailyTheme(dailyTheme) {
  const date = state.jaelyo.selectedDate;
  if (!date) return false;
  const previous = state.jaelyo.board;
  try {
    state.jaelyo.board = await putJaelyoDailyTheme(date, dailyTheme);
    paintJaelyo();
    return true;
  } catch (e) {
    state.jaelyo.board = previous;
    paintJaelyo();
    alert(`오늘의 테마 저장 실패 — 변경이 취소되었습니다.\n${e.message}`);
    return false;
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

  // 전광판 아래: 탭(재료정리 / 매크로 지표) + 내용 영역
  app.appendChild(renderBottomTabs());
  const bottomContent = document.createElement('div');
  bottomContent.id = 'bottom-content';
  app.appendChild(bottomContent);
  paintBottom();
}

function renderTabs() {
  const nav = document.createElement('nav');
  nav.className = 'tabs';
  for (const g of state.list.groups) {
    const tab = document.createElement('button');
    tab.className = 'tab' + (g.id === activeGroup()?.id ? ' active' : '');
    tab.textContent = `${g.name} (${g.tickers.filter((t) => t.type !== 'memo').length})`; // memo row 제외한 종목 수
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

  // 빈칸 메모 한 줄 추가 (키움 관심종목식 구분/메모 행)
  const addMemo = document.createElement('button');
  addMemo.className = 'ghost';
  addMemo.textContent = '＋ 빈칸 메모';
  addMemo.addEventListener('click', () => addMemoRow(g));

  // 종목 검색 + 자동완성 (실제 검색 결과에서 선택해야만 추가 → 잘못된 코드 방지)
  bar.append(rename, del, addMemo, renderTickerSearch(g));
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
    onRemove: (row, index) => removeRow(g, index),
    onChart: (row) => openChart(row),
    onReorderRow: (fromIndex, toIndex) => reorderRow(g, fromIndex, toIndex),
    onEditMemo: (row, index, text) => editMemoRow(g, index, text),
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
  // US = TradingView 임베드, KR = lightweight-charts(우리 데이터; 무료 임베드는 KRX 미지원).
  const content = row.market === 'US' ? usChart(row) : krChart(row);
  body.appendChild(content);

  modal.append(head, body);
  overlay.appendChild(modal);

  const remove = () => {
    content._cleanup?.(); // 차트 인스턴스 정리
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

// KR: lightweight-charts 인터랙티브 캔들(확대/이동/크로스헤어) + 네이버 데이터.
const LWC_CDN = 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.mjs';
const UP = '#ff4d4f';   // 한국식 상승=빨강
const DOWN = '#4d7bff'; // 한국식 하락=파랑

function krChart(row) {
  const wrap = document.createElement('div');
  wrap.className = 'lw-chart';

  const tabs = document.createElement('div');
  tabs.className = 'chart-periods';

  const box = document.createElement('div');
  box.className = 'chart-canvas';
  const status = document.createElement('div');
  status.className = 'chart-status';
  box.appendChild(status);

  const link = document.createElement('a');
  link.href = `https://finance.naver.com/item/main.naver?code=${row.code}`;
  link.target = '_blank';
  link.rel = 'noopener';
  link.className = 'chart-link';
  link.textContent = '네이버 금융에서 보기 ↗';

  let chart = null, candleSeries = null, volSeries = null, LWC = null, reqId = 0;

  async function load(range) {
    const myId = ++reqId;
    status.style.display = 'block';
    status.textContent = '불러오는 중…';
    const candles = await getHistory('KR', row.code, range);
    if (myId !== reqId) return;
    if (!candles.length) { status.textContent = '차트 데이터를 불러오지 못했습니다.'; return; }
    try {
      if (!LWC) LWC = await import(LWC_CDN);
      if (myId !== reqId) return;
      if (!chart) {
        chart = LWC.createChart(box, {
          autoSize: true,
          layout: { background: { color: 'transparent' }, textColor: '#8b94a7' },
          grid: { vertLines: { color: 'rgba(42,51,68,.4)' }, horzLines: { color: 'rgba(42,51,68,.4)' } },
          rightPriceScale: { borderColor: '#2a3344' },
          timeScale: { borderColor: '#2a3344' },
          crosshair: { mode: LWC.CrosshairMode.Normal },
        });
        candleSeries = chart.addCandlestickSeries({
          upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN,
        });
        volSeries = chart.addHistogramSeries({ priceScaleId: '', priceFormat: { type: 'volume' } });
        volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      }
      candleSeries.setData(candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
      volSeries.setData(candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(255,77,79,.45)' : 'rgba(77,123,255,.45)' })));
      chart.timeScale().fitContent();
      status.style.display = 'none';
    } catch (e) {
      status.textContent = `차트 로드 실패: ${e.message}`;
    }
  }

  for (const [r, label] of [['1mo', '1개월'], ['3mo', '3개월'], ['6mo', '6개월'], ['1y', '1년']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chart-period';
    b.textContent = label;
    b.addEventListener('click', () => {
      tabs.querySelectorAll('.chart-period').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      load(r);
    });
    tabs.appendChild(b);
  }
  tabs.children[2].classList.add('active'); // 6개월 기본

  wrap.append(tabs, box, link);
  load('6mo');

  wrap._cleanup = () => { try { chart?.remove(); } catch { /* noop */ } };
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

// 행(종목/메모) 삭제 — 렌더 행과 g.tickers 는 1:1 인덱스 대응.
function removeRow(g, index) {
  if (!g.tickers[index]) return;
  const prev = clone();
  g.tickers.splice(index, 1);
  save(prev);
}

// 빈칸 메모 행 추가: 그룹 끝에 빈 text로 추가 후 저장.
function addMemoRow(g) {
  const prev = clone();
  g.tickers.push({ type: 'memo', id: `m${Date.now()}${Math.floor(Math.random() * 1000)}`, text: '' });
  save(prev);
}

// 드래그앤드랍 순서 변경. 경계 밖/동일 위치는 무시.
function reorderRow(g, fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 || fromIndex >= g.tickers.length ||
    toIndex < 0 || toIndex >= g.tickers.length
  ) return;
  const prev = clone();
  const [row] = g.tickers.splice(fromIndex, 1);
  g.tickers.splice(toIndex, 0, row);
  save(prev);
}

// memo row 텍스트 inline 수정. 빈 문자열도 그대로 저장.
function editMemoRow(g, index, text) {
  const row = g.tickers[index];
  if (!row || row.type !== 'memo') return;
  const prev = clone();
  row.text = text;
  save(prev);
}

// ---------- 새로고침 (실시간 시세) ----------

async function refresh() {
  const g = activeGroup();
  const stocks = g ? g.tickers.filter((t) => t.type !== 'memo') : []; // memo row는 시세 조회 제외
  if (!stocks.length) return;
  state.loading = true;
  renderApp();
  try {
    const { updatedAt, quotes } = await getQuotes(stocks.map((t) => ({ market: t.market, code: t.code })));
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
