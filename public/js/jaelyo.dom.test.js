import { test } from 'node:test';
import assert from 'node:assert/strict';

// 최소 DOM 스텁 — jaelyo.js 렌더 로직을 브라우저 없이 실행. select/input value·change 지원.
class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.parent = null;
    this.className = '';
    this.title = '';
    this.type = '';
    this.value = '';
    this.attrs = {};
    this._text = '';
    this._listeners = {};
  }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  get textContent() { return this._text; }
  set innerHTML(v) { this.children = []; this._text = ''; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) { c.parent = this; this.children.push(c); } }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  focus() { FakeEl.focused = this; }
  addEventListener(type, fn) { this._listeners[type] = fn; }
  dispatch(type, ev) { this._listeners[type]?.(ev); }
  click() { this.dispatch('click', { target: this }); }
  allText() {
    let t = this._text || '';
    for (const c of this.children) t += ' ' + c.allText();
    return t.trim();
  }
  collectClasses(acc = []) {
    if (this.className) acc.push(...this.className.split(/\s+/).filter(Boolean));
    for (const c of this.children) c.collectClasses(acc);
    return acc;
  }
  findAll(tag, acc = []) {
    if (this.tagName === tag) acc.push(this);
    for (const c of this.children) c.findAll(tag, acc);
    return acc;
  }
  findByClass(cls, acc = []) {
    if (this.className.split(/\s+/).includes(cls)) acc.push(this);
    for (const c of this.children) c.findByClass(cls, acc);
    return acc;
  }
}
// document 스텁 — 모달은 document.body에 붙고 Escape는 document keydown으로 닫힌다.
const docListeners = {};
globalThis.document = {
  createElement: (t) => new FakeEl(t),
  body: new FakeEl('body'),
  activeElement: null,
  addEventListener: (type, fn) => { docListeners[type] = fn; },
  removeEventListener: (type) => { delete docListeners[type]; },
  // 테스트에서 문서 레벨 키 이벤트를 발생시키는 헬퍼
  fireKey: (key) => docListeners.keydown?.({ key }),
};

const { renderJaelyo, MANUAL_COLS, naverNewsSearchUrl, openMemoModal } = await import('./jaelyo.js');
const { MANUAL_FIELDS } = await import('../../functions/api/_jaelyo-core.js');

// 서버/클라이언트 수동필드 계약 패리티 — public/은 functions/를 import할 수 없어
// 두 곳에 정의되므로, 키 집합·순서가 어긋나면 CI에서 잡는다.
// 표 열(MANUAL_COLS 7개)은 구조화 필드, 자유 메모(notes)는 표 열이 아니라 팝업 전용이므로
// 서버 MANUAL_FIELDS = [...구조화 열 키, 'notes'] 여야 한다.
test('패리티: MANUAL_COLS 열 키 + notes 자유메모 = 서버 MANUAL_FIELDS(순서 포함)', () => {
  assert.deepEqual([...MANUAL_COLS.map((c) => c.key), 'notes'], MANUAL_FIELDS);
});

function sampleBoard() {
  return {
    date: '2026-05-07',
    dailyTheme: {
      text: '반도체/HBM 70% · 건설 20%',
      source: 'auto',
      criteria: { rankLimit: 30, positiveChangeOnly: true, minTradingValue: 400_000_000_000, scoring: 'themeStockCount' },
      items: [{ theme: '반도체/HBM', sharePct: 70, count: 7, topStocks: [] }],
    },
    rows: [
      { rank: 5, prevRank: 1063, code: '028050', name: '삼성E&A', price: 64900, changePct: 23.6, marketCap: 1.27e12, tradingValue: 5e11, tvToMcapPct: 25, manual: { newOrExisting: '', theme: '건설', material: '', materialPersistence: '', materialContinuity: '', financials: '', supplyDemand: '' } },
      { rank: 1, prevRank: 1, code: '005930', name: '삼성전자', price: 81000, changePct: 1.2, marketCap: 5e14, tradingValue: 1e11, tvToMcapPct: 0.02, manual: { newOrExisting: '기존', theme: '', material: '', materialPersistence: '', materialContinuity: '', financials: '', supplyDemand: '' } },
    ],
  };
}

test('renderJaelyo: 16열 헤더 렌더', () => {
  const root = new FakeEl('div');
  renderJaelyo(root, { dates: ['2026-05-07'], selectedDate: '2026-05-07', board: sampleBoard() });
  const text = root.allText();
  for (const h of ['순위', '전일순위', '종목코드', '종목명', '현재가', '등락률', '시가총액', '거래대금', '시총대비', '신규/기존', '테마', '재료', '재료지속성', '재료연속여부', '재무', '수급']) {
    assert.ok(text.includes(h), `헤더 ${h}`);
  }
  const ths = root.findAll('th');
  assert.equal(ths.length, 16);
});

test('renderJaelyo: 오늘의 테마 패널 렌더 + 저장 콜백', async () => {
  const root = new FakeEl('div');
  let saved = null;
  renderJaelyo(root, {
    dates: ['2026-05-07'], selectedDate: '2026-05-07', board: sampleBoard(),
    onEditDailyTheme: async (theme) => { saved = theme; return true; },
  });
  assert.ok(root.findByClass('jaelyo-theme-panel')[0], '오늘의 테마 패널');
  assert.ok(root.allText().includes('상승·4000억+·등락률30·개수기준'));
  assert.ok(root.allText().includes('반도체/HBM 70.0%'));
  const ta = root.findByClass('jaelyo-theme-text')[0];
  ta.value = '수정한 오늘의 테마';
  await root.findByClass('jaelyo-theme-save')[0]._listeners.click();
  assert.equal(saved.text, '수정한 오늘의 테마');
});

test('renderJaelyo: 등락률 내림차순 표시 (데이터 rank와 무관)', () => {
  const root = new FakeEl('div');
  renderJaelyo(root, { dates: ['2026-05-07'], selectedDate: '2026-05-07', board: sampleBoard() });
  const text = root.allText();
  // 삼성E&A(23.6%)가 삼성전자(1.2%)보다 앞에
  assert.ok(text.indexOf('삼성E&A') < text.indexOf('삼성전자'), '등락률 높은 종목 먼저');
});

test('renderJaelyo: 임계값 셀 강조 클래스', () => {
  const root = new FakeEl('div');
  renderJaelyo(root, { dates: ['2026-05-07'], selectedDate: '2026-05-07', board: sampleBoard() });
  const classes = root.collectClasses();
  // 삼성E&A: 등락 23.6≥10, 시총 1.27조≤2조, 거래대금 5e11≥4e11, 비율 25>20 → 4개 강조
  assert.ok(classes.includes('hot-change'), 'hot-change');
  assert.ok(classes.includes('small-cap'), 'small-cap');
  assert.ok(classes.includes('high-tv'), 'high-tv');
  assert.ok(classes.includes('high-ratio'), 'high-ratio');
});

test('renderJaelyo: 임계값 미만은 강조 없음', () => {
  const root = new FakeEl('div');
  const board = { date: '2026-05-07', rows: [
    { rank: 1, prevRank: null, code: '005930', name: '삼성전자', price: 81000, changePct: 1.2, marketCap: 5e14, tradingValue: 1e11, tvToMcapPct: 0.02, manual: { newOrExisting: '', theme: '', material: '', materialPersistence: '', materialContinuity: '', financials: '', supplyDemand: '' } },
  ] };
  renderJaelyo(root, { dates: ['2026-05-07'], selectedDate: '2026-05-07', board });
  const classes = root.collectClasses();
  assert.ok(!classes.includes('hot-change'));
  assert.ok(!classes.includes('high-ratio'));
});

test('naverNewsSearchUrl: 종목명 인코딩 + 수집 날짜로 기간 제한', () => {
  const url = naverNewsSearchUrl('삼성E&A', '2026-05-07');
  assert.ok(url.startsWith('https://search.naver.com/search.naver?where=news'), '네이버뉴스 검색 URL');
  // query는 인코딩되어 &가 검색어를 깨지 않음
  assert.ok(url.includes(`query=${encodeURIComponent('삼성E&A')}`), 'query 인코딩');
  // 날짜 파라미터: ds/de(점 형식) + nso 기간
  assert.ok(url.includes('ds=2026.05.07'), 'ds 기간 시작');
  assert.ok(url.includes('de=2026.05.07'), 'de 기간 끝');
  assert.ok(url.includes(encodeURIComponent('from20260507to20260507')), 'nso from/to');
});

test('naverNewsSearchUrl: 날짜 없거나 형식 어긋나면 기간 파라미터 없음', () => {
  const noDate = naverNewsSearchUrl('삼성전자', null);
  assert.ok(noDate.includes(`query=${encodeURIComponent('삼성전자')}`));
  assert.ok(!noDate.includes('ds='), '날짜 없으면 ds 없음');
  const bad = naverNewsSearchUrl('삼성전자', '2026/05/07');
  assert.ok(!bad.includes('ds='), '형식 어긋나면 ds 없음');
});

test('renderJaelyo: 종목코드는 네이버뉴스 검색 anchor(새 탭 + 종목명 검색 + 날짜 파라미터)', () => {
  const root = new FakeEl('div');
  renderJaelyo(root, { dates: ['2026-05-07'], selectedDate: '2026-05-07', board: sampleBoard() });
  const anchors = root.findAll('a').filter((a) => a.className.includes('jaelyo-code-link'));
  assert.equal(anchors.length, 2, '행마다 종목코드 anchor');
  // 표시 텍스트는 종목코드, 검색어(query)는 종목명
  const a = anchors.find((x) => x.textContent === '028050');
  assert.ok(a, '종목코드가 anchor 텍스트');
  assert.ok(a.href.startsWith('https://search.naver.com/search.naver?where=news'), '네이버뉴스 검색 href');
  assert.ok(a.href.includes(`query=${encodeURIComponent('삼성E&A')}`), 'query에 종목명');
  assert.ok(a.href.includes('ds=2026.05.07') && a.href.includes('de=2026.05.07'), 'href에 수집 날짜');
  assert.equal(a.target, '_blank', '새 탭');
  assert.ok(a.rel.includes('noopener'), 'rel noopener');
  assert.ok(a.rel.includes('noreferrer'), 'rel noreferrer');
});

// 해당 행의 종목코드 anchor를 찾는 헬퍼.
function codeAnchor(codeText = '028050') {
  const root = new FakeEl('div');
  renderJaelyo(root, { dates: ['2026-05-07'], selectedDate: '2026-05-07', board: sampleBoard() });
  return root.findAll('a').find((x) => x.className.includes('jaelyo-code-link') && x.textContent === codeText);
}

test('종목코드 클릭: preventDefault + window.open이 _blank(noopener,noreferrer)로 호출', () => {
  const a = codeAnchor('028050');
  assert.ok(a, '종목코드 anchor 존재');
  let openArgs = null;
  const prevWindow = globalThis.window;
  // window.open이 새 창을 성공적으로 연 상황(truthy 반환) 재현
  globalThis.window = { open: (...args) => { openArgs = args; return {}; } };
  let prevented = false;
  try {
    a.dispatch('click', { preventDefault: () => { prevented = true; } });
  } finally {
    globalThis.window = prevWindow;
  }
  assert.ok(prevented, '기본 이동 preventDefault 호출');
  assert.ok(openArgs, 'window.open 호출됨');
  assert.equal(openArgs[0], a.href, '동일한 뉴스 URL로 오픈');
  assert.equal(openArgs[1], '_blank', '새 탭/새 창 타깃');
  assert.equal(openArgs[2], 'noopener,noreferrer', 'noopener,noreferrer 기능');
});

test('종목코드 클릭: window.open 없는 환경이면 예외 없이 기본 target=_blank 폴백', () => {
  const a = codeAnchor('028050');
  const prevWindow = globalThis.window;
  globalThis.window = {}; // window.open 미제공
  let prevented = false;
  try {
    assert.doesNotThrow(() => {
      a.dispatch('click', { preventDefault: () => { prevented = true; } });
    }, 'window.open 없어도 예외 없음');
  } finally {
    globalThis.window = prevWindow;
  }
  assert.equal(prevented, false, 'window.open 없으면 기본 이동을 막지 않음(anchor target=_blank 폴백)');
});

test('renderJaelyo: selectedDate 없으면 board.date로 뉴스 기간', () => {
  const root = new FakeEl('div');
  renderJaelyo(root, { dates: ['2026-05-07'], selectedDate: null, board: sampleBoard() });
  const a = root.findAll('a').find((x) => x.className.includes('jaelyo-code-link'));
  assert.ok(a.href.includes('ds=2026.05.07'), 'board.date(2026-05-07)로 기간 제한');
});

test('renderJaelyo: 신규/기존 select 변경 → onEditManual(code, {newOrExisting})', () => {
  const root = new FakeEl('div');
  let captured = null;
  renderJaelyo(root, {
    dates: ['2026-05-07'], selectedDate: '2026-05-07', board: sampleBoard(),
    onEditManual: (code, patch) => { captured = { code, patch }; },
  });
  const selects = root.findAll('select');
  // 첫 select는 날짜 드롭다운, 그 다음부터 신규/기존 셀
  const newOrExisting = selects.find((s) => s.className.includes('manual-input'));
  assert.ok(newOrExisting, '신규/기존 select 존재');
  newOrExisting.value = '신규';
  newOrExisting.dispatch('change');
  assert.deepEqual(captured, { code: '028050', patch: { newOrExisting: '신규' } });
});

test('renderJaelyo: 테마 input 변경 → onEditManual(code, {theme})', () => {
  const root = new FakeEl('div');
  let captured = null;
  renderJaelyo(root, {
    dates: ['2026-05-07'], selectedDate: '2026-05-07', board: sampleBoard(),
    onEditManual: (code, patch) => { captured = { code, patch }; },
  });
  const inputs = root.findAll('input');
  const themeInput = inputs[0]; // 첫 행 첫 텍스트 입력 = 테마
  themeInput.value = '바이오';
  themeInput.dispatch('change');
  assert.equal(captured.code, '028050');
  assert.equal(captured.patch.theme, '바이오');
});

test('renderJaelyo: 날짜 select 변경 → onSelectDate', () => {
  const root = new FakeEl('div');
  let picked = null;
  renderJaelyo(root, {
    dates: ['2026-05-09', '2026-05-07'], selectedDate: '2026-05-09', board: sampleBoard(),
    onSelectDate: (d) => { picked = d; },
  });
  const dateSelect = root.findByClass('jaelyo-date')[0];
  assert.ok(dateSelect, '날짜 드롭다운 존재');
  // 옵션 라벨은 요일 포함, value는 원본 날짜 유지
  const opt = dateSelect.children[0];
  assert.match(opt.textContent, /^2026-05-09\(\w{3}\.\)$/, '라벨에 요일 표기');
  assert.equal(opt.value, '2026-05-09', 'value는 원본 YYYY-MM-DD');
  dateSelect.value = '2026-05-07';
  dateSelect.dispatch('change');
  assert.equal(picked, '2026-05-07');
});

test('renderJaelyo: onChart 있으면 현재가가 클릭 가능한 버튼(jaelyo-price-btn) + title', () => {
  const root = new FakeEl('div');
  renderJaelyo(root, {
    dates: ['2026-05-07'], selectedDate: '2026-05-07', board: sampleBoard(),
    onChart: () => {},
  });
  const btns = root.findByClass('jaelyo-price-btn');
  assert.equal(btns.length, 2, '행마다 현재가 버튼');
  assert.equal(btns[0].tagName, 'button', 'button 요소');
  assert.equal(btns[0].type, 'button');
  assert.ok(btns[0].title.includes('차트'), '버튼 title에 차트');
});

test('renderJaelyo: 현재가 클릭 시 {market:"KR", code, name} 전달', () => {
  const root = new FakeEl('div');
  let arg = null;
  renderJaelyo(root, {
    dates: ['2026-05-07'], selectedDate: '2026-05-07', board: sampleBoard(),
    onChart: (r) => { arg = r; },
  });
  // 삼성E&A(64,900) 행의 현재가 버튼
  const btn = root.findByClass('jaelyo-price-btn').find((b) => b.textContent.includes('64,900'));
  assert.ok(btn, '현재가 버튼 존재');
  btn.click();
  assert.deepEqual(arg, { market: 'KR', code: '028050', name: '삼성E&A' });
});

test('renderJaelyo: onChart 없으면 현재가는 plain 텍스트 (버튼 없음)', () => {
  const root = new FakeEl('div');
  renderJaelyo(root, { dates: ['2026-05-07'], selectedDate: '2026-05-07', board: sampleBoard() });
  assert.equal(root.findByClass('jaelyo-price-btn').length, 0, '현재가 버튼 없음');
  assert.ok(root.allText().includes('64,900'), '현재가 텍스트는 표시');
});

// 메모 팝업이 붙을 신선한 body로 초기화하고, 열린 오버레이를 반환.
// 팝업은 종목명 버튼(jaelyo-name-btn)으로 연다 — 인자는 종목코드지만 해당 행의 종목명 버튼을 찾아 클릭한다.
function openBoardMemo(codeText = '028050', boardOverride = null) {
  document.body = new FakeEl('body');
  const board = boardOverride || memoBoard();
  const root = new FakeEl('div');
  renderJaelyo(root, { dates: ['2026-05-07'], selectedDate: '2026-05-07', board });
  const rowName = board.rows.find((r) => r.code === codeText)?.name;
  const btn = root.findByClass('jaelyo-name-btn').find((b) => b.textContent === rowName);
  assert.ok(btn, `종목명 버튼(${rowName}) 존재`);
  btn.click();
  const overlay = document.body.findByClass('memo-overlay')[0];
  assert.ok(overlay, '메모 오버레이가 body에 추가됨');
  return { root, btn, overlay };
}

// 메모 필드가 채워진 샘플 — 세계 영향력=materialContinuity, 국내 영향력=supplyDemand 매핑 확인용.
function memoBoard() {
  return {
    date: '2026-05-07',
    rows: [
      { rank: 5, prevRank: 1063, code: '028050', name: '삼성E&A', price: 64900, changePct: 23.6, marketCap: 1.27e12, tradingValue: 5e11, tvToMcapPct: 25,
        manual: { newOrExisting: '신규', theme: '로봇', material: '엑추에이터 제조', materialPersistence: '중', materialContinuity: '글로벌 로봇 수요 확대', financials: '흑자', supplyDemand: '기관 순매수' } },
      { rank: 1, prevRank: 1, code: '005930', name: '삼성전자', price: 81000, changePct: 1.2, marketCap: 5e14, tradingValue: 1e11, tvToMcapPct: 0.02,
        manual: { newOrExisting: '', theme: '', material: '', materialPersistence: '', materialContinuity: '', financials: '', supplyDemand: '' } },
    ],
  };
}

test('renderJaelyo: 종목명은 메모 팝업을 여는 클릭 가능한 버튼(jaelyo-name-btn)으로 렌더', () => {
  const root = new FakeEl('div');
  renderJaelyo(root, { dates: ['2026-05-07'], selectedDate: '2026-05-07', board: memoBoard() });
  const btns = root.findByClass('jaelyo-name-btn');
  assert.equal(btns.length, 2, '행마다 종목명 버튼');
  const b = btns.find((x) => x.textContent === '삼성E&A');
  assert.ok(b, '종목명이 버튼 텍스트');
  assert.equal(b.tagName, 'button', 'button 요소');
  assert.equal(b.type, 'button');
});

test('renderJaelyo: 종목명 버튼 클릭 시 notes 팝업이 열린다', () => {
  document.body = new FakeEl('body');
  const root = new FakeEl('div');
  renderJaelyo(root, { dates: ['2026-05-07'], selectedDate: '2026-05-07', board: memoBoard() });
  const b = root.findByClass('jaelyo-name-btn').find((x) => x.textContent === '삼성E&A');
  b.click();
  const overlay = document.body.findByClass('memo-overlay')[0];
  assert.ok(overlay, '종목명 클릭으로 메모 팝업 열림');
  assert.ok(overlay.findAll('textarea').some((t) => (t.className || '').includes('memo-textarea')), '자유 메모 textarea 존재');
});

// 팝업의 읽기 전용 구조화 요약 값들(memo-value)을 모은다.
function summaryValues(overlay) {
  return overlay.findByClass('memo-value').map((el) => el.textContent);
}

test('openMemoModal: 클릭 시 dialog 열리고 종목명/코드 + 구조화 필드 읽기 전용 요약 표시', () => {
  const { overlay } = openBoardMemo('028050');
  const dialog = overlay.findByClass('memo-modal')[0];
  assert.ok(dialog, '메모 모달 존재');
  // 접근성: role=dialog + aria-modal + 제목 연결
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  const titleId = dialog.getAttribute('aria-labelledby');
  const titleEl = overlay.findByClass('modal-title')[0];
  assert.equal(titleEl.id, titleId, 'aria-labelledby가 제목 id와 연결');

  const text = overlay.allText();
  assert.ok(text.includes('삼성E&A'), '종목명');
  assert.ok(text.includes('028050'), '종목코드');
  // 표 열과 동일한 요약 라벨
  for (const label of ['신규/기존', '테마', '재료', '재료지속성', '재료연속여부', '재무', '수급']) {
    assert.ok(text.includes(label), `요약 라벨 ${label}`);
  }
  // 구조화 값은 읽기 전용 텍스트(memo-value)로 표시된다
  const vals = summaryValues(overlay);
  assert.ok(vals.includes('로봇'), '테마 값(읽기 전용)');
  assert.ok(vals.includes('엑추에이터 제조'), '재료 값(읽기 전용)');
  assert.ok(vals.includes('글로벌 로봇 수요 확대'), 'materialContinuity 값(읽기 전용)');
  assert.ok(vals.includes('기관 순매수'), 'supplyDemand 값(읽기 전용)');
  // 팝업엔 구조화 편집 컨트롤이 없다 — select 없음, 편집 input 없음(textarea만 편집 가능)
  assert.equal(overlay.findAll('select').length, 0, '팝업에 select 없음');
  const editableInputs = overlay.findAll('input').filter((i) => (i.className || '').includes('memo-input'));
  assert.equal(editableInputs.length, 0, '팝업에 구조화 text input 없음');
});

test('openMemoModal: 빈 구조화 필드는 —(NA)로 표시, notes는 빈 textarea', () => {
  const { overlay } = openBoardMemo('005930');
  const vals = summaryValues(overlay);
  assert.ok(vals.length > 0, '요약 값 렌더');
  assert.ok(vals.every((v) => v === '—'), '빈 종목은 모든 구조화 값이 —');
  assert.equal(notesTextarea(overlay).value, '', 'notes 비어있음');
});

test('openMemoModal: 닫기 버튼으로 닫힘 + 포커스 복원', () => {
  const { btn, overlay } = openBoardMemo('028050');
  const closeBtn = overlay.findByClass('modal-close')[0];
  assert.ok(closeBtn, '닫기 버튼');
  assert.equal(FakeEl.focused, closeBtn, '열릴 때 닫기 버튼에 포커스');
  closeBtn.click();
  assert.equal(document.body.findByClass('memo-overlay').length, 0, '오버레이 제거됨');
});

test('openMemoModal: Escape 키로 닫힘', () => {
  openBoardMemo('028050');
  assert.equal(document.body.findByClass('memo-overlay').length, 1, '열림');
  document.fireKey('Escape');
  assert.equal(document.body.findByClass('memo-overlay').length, 0, 'Escape로 닫힘');
});

test('openMemoModal: backdrop(오버레이 바깥) 클릭으로 닫힘', () => {
  const { overlay } = openBoardMemo('028050');
  overlay.dispatch('click', { target: overlay }); // 오버레이 자신 = 바깥
  assert.equal(document.body.findByClass('memo-overlay').length, 0, 'backdrop 클릭으로 닫힘');
});

// 팝업 내 자유 메모 textarea 조회 헬퍼.
function notesTextarea(overlay) {
  return overlay.findAll('textarea').find((t) => (t.className || '').includes('memo-textarea'));
}

test('openMemoModal: 자유 메모 textarea 렌더 + 기존 notes 값 표시', () => {
  const board = memoBoard();
  board.rows[0].manual.notes = '(로봇) 액추에이터 제조\n세계: 확대\n국내: 순매수';
  const { overlay } = openBoardMemo('028050', board);
  const ta = notesTextarea(overlay);
  assert.ok(ta, '자유 메모 textarea 존재');
  assert.equal(ta.value, '(로봇) 액추에이터 제조\n세계: 확대\n국내: 순매수', '기존 notes 값을 여러 줄로 표시');
});

test('openMemoModal: notes 없고 레거시 memo만 있으면 textarea에 memo 표시', () => {
  const board = memoBoard();
  board.rows[0].manual.memo = '레거시 원문 메모';
  const { overlay } = openBoardMemo('028050', board);
  assert.equal(notesTextarea(overlay).value, '레거시 원문 메모', 'notes 폴백으로 memo 노출');
});

// onEditManual을 주입해 팝업을 여는 헬퍼 — 저장 콜백 캡처용.
function openMemoWithSave(codeText, onEditManual, boardOverride = null) {
  document.body = new FakeEl('body');
  const root = new FakeEl('div');
  renderJaelyo(root, {
    dates: ['2026-05-07'], selectedDate: '2026-05-07', board: boardOverride || memoBoard(),
    onEditManual,
  });
  const board = boardOverride || memoBoard();
  const rowName = board.rows.find((r) => r.code === codeText)?.name;
  const btn = root.findByClass('jaelyo-name-btn').find((b) => b.textContent === rowName);
  btn.click();
  const overlay = document.body.findByClass('memo-overlay')[0];
  return { overlay };
}

test('openMemoModal: 자유 메모 수정 후 저장 → onEditManual(code, {notes})만 호출 + 팝업 닫힘', async () => {
  let captured = null;
  const onEditManual = (code, patch) => { captured = { code, patch }; return true; };
  const { overlay } = openMemoWithSave('028050', onEditManual);
  const ta = notesTextarea(overlay);
  ta.value = '신규 자유 메모\n둘째 줄';
  const saveBtn = overlay.findByClass('memo-save')[0];
  assert.ok(saveBtn, '저장 버튼 존재');
  await saveBtn.dispatch('click');
  assert.equal(captured.code, '028050');
  assert.deepEqual(Object.keys(captured.patch), ['notes'], 'patch 키는 notes 하나뿐');
  assert.equal(captured.patch.notes, '신규 자유 메모\n둘째 줄', 'notes 값 전달');
  assert.equal(document.body.findByClass('memo-overlay').length, 0, '저장 성공 시 팝업 닫힘');
});

test('openMemoModal: 저장 patch에 구조화 필드(theme/material 등)를 절대 포함하지 않음', async () => {
  let captured = null;
  const onEditManual = (code, patch) => { captured = { code, patch }; return true; };
  // 구조화 값이 채워진 종목(028050)으로 열어도 저장 patch엔 notes만 담긴다.
  const { overlay } = openMemoWithSave('028050', onEditManual);
  notesTextarea(overlay).value = '메모만 저장';
  await overlay.findByClass('memo-save')[0].dispatch('click');
  assert.deepEqual(Object.keys(captured.patch), ['notes'], 'notes 외 키 없음');
  for (const k of ['theme', 'material', 'materialContinuity', 'supplyDemand', 'materialPersistence', 'financials', 'newOrExisting']) {
    assert.ok(!(k in captured.patch), `구조화 필드 ${k} 미포함`);
  }
});

test('openMemoModal: 저장 실패(onEditManual false) 시 팝업 유지', async () => {
  const onEditManual = () => false; // 저장 실패
  const { overlay } = openMemoWithSave('028050', onEditManual);
  await overlay.findByClass('memo-save')[0].dispatch('click');
  assert.equal(document.body.findByClass('memo-overlay').length, 1, '실패 시 팝업 유지');
});

test('renderJaelyo: 빈 보드 → 안내 문구', () => {
  const root = new FakeEl('div');
  renderJaelyo(root, { dates: ['2026-05-07'], selectedDate: '2026-05-07', board: { date: '2026-05-07', rows: [] } });
  assert.ok(root.allText().includes('수집 데이터가 없습니다'));
});

test('renderJaelyo: 수집 날짜 없음 → 드롭다운 안내', () => {
  const root = new FakeEl('div');
  renderJaelyo(root, { dates: [], selectedDate: null, board: null });
  assert.ok(root.allText().includes('수집된 날짜 없음'));
});
