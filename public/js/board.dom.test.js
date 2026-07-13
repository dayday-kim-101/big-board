import { test } from 'node:test';
import assert from 'node:assert/strict';

// 최소 DOM 스텁 — board.js의 실제 렌더 로직을 브라우저 없이 실행한다.
class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.className = '';
    this.title = '';
    this._text = '';
  }
  set textContent(v) { this._text = v; this.children = []; }
  get textContent() { return this._text; }
  set innerHTML(v) { this.children = []; this._text = ''; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(type, fn) { (this._listeners ||= {})[type] = fn; }
  dispatch(type, ev = {}) { this._listeners?.[type]?.(ev); }
  blur() { this._listeners?.blur?.(); }
  click() { this._listeners?.click?.(); }
  allText() {
    let t = this._text || '';
    for (const c of this.children) t += ' ' + c.allText();
    return t.trim();
  }
  collectClasses(acc = []) {
    if (this.className) acc.push(...this.className.split(/\s+/));
    for (const c of this.children) c.collectClasses(acc);
    return acc;
  }
  // className으로 첫 노드 찾기
  find(cls) {
    if (this.className.split(/\s+/).includes(cls)) return this;
    for (const c of this.children) {
      const hit = c.find(cls);
      if (hit) return hit;
    }
    return null;
  }
  // className으로 모든 노드 찾기 (문서 순서)
  findAll(cls, acc = []) {
    if (this.className.split(/\s+/).includes(cls)) acc.push(this);
    for (const c of this.children) c.findAll(cls, acc);
    return acc;
  }
}
globalThis.document = { createElement: (t) => new FakeEl(t) };

const { renderBoard } = await import('./board.js');

test('renderBoard: 6열 헤더 + 종목명/시세 렌더', () => {
  const root = new FakeEl('div');
  const group = { id: 'g0', name: '관심', rows: [
    { market: 'KR', code: '005930', name: '삼성전자',
      quote: { price: 349000, change: 32000, changePct: 10.09, volume: 39372103, tradingValue: 13440623000000, approxTradingValue: false } },
  ] };
  renderBoard(root, group, {});
  const text = root.allText();
  for (const h of ['종목', '현재가', '등락', '등락률', '거래량', '거래대금']) {
    assert.ok(text.includes(h), `헤더 ${h} 포함`);
  }
  assert.ok(text.includes('삼성전자'), '종목명');
  assert.ok(text.includes('349,000'), '현재가 포맷');
  assert.ok(text.includes('13.44조'), 'KR 거래대금 조 단위');
});

test('renderBoard: 상승 종목 → tone-up 클래스(빨강)', () => {
  const root = new FakeEl('div');
  renderBoard(root, { id: 'g', name: 'x', rows: [
    { market: 'KR', code: '005930', name: '삼성', quote: { price: 1, change: 100, changePct: 1, volume: 1, tradingValue: 1, approxTradingValue: false } },
  ] }, {});
  assert.ok(root.collectClasses().includes('tone-up'), '상승은 tone-up');
});

test('renderBoard: 하락 종목 → tone-down 클래스(파랑)', () => {
  const root = new FakeEl('div');
  renderBoard(root, { id: 'g', name: 'x', rows: [
    { market: 'KR', code: '000660', name: 'SK', quote: { price: 1, change: -100, changePct: -1, volume: 1, tradingValue: 1, approxTradingValue: false } },
  ] }, {});
  assert.ok(root.collectClasses().includes('tone-down'), '하락은 tone-down');
});

test('renderBoard: US 근사 거래대금 → approx 마커(*)', () => {
  const root = new FakeEl('div');
  renderBoard(root, { id: 'g', name: 'x', rows: [
    { market: 'US', code: 'AAPL', name: 'Apple', quote: { price: 312.06, change: -0.45, changePct: -0.14, volume: 70026752, tradingValue: 21852548229, approxTradingValue: true } },
  ] }, {});
  assert.ok(root.collectClasses().includes('approx'), 'US 근사 마커 존재');
  assert.ok(root.allText().includes('$21.9B'), 'US 거래대금 compact');
});

test('renderBoard: 빈 그룹 → 안내 문구', () => {
  const root = new FakeEl('div');
  renderBoard(root, { id: 'g', name: '관심', rows: [] }, {});
  assert.ok(root.allText().includes('종목이 없습니다'), '빈 그룹 안내');
});

test('renderBoard: 시세 없는 종목 → 대시(—) 표시, 행은 렌더', () => {
  const root = new FakeEl('div');
  renderBoard(root, { id: 'g', name: 'x', rows: [
    { market: 'KR', code: '005930', name: '삼성', quote: null },
  ] }, {});
  const text = root.allText();
  assert.ok(text.includes('삼성'), '종목명은 표시');
  assert.ok(text.includes('—'), '시세 없음은 대시');
  assert.ok(root.collectClasses().includes('tone-na'), 'tone-na 클래스');
});

test('renderBoard: onChart 있으면 종목명 클릭 시 해당 row로 콜백', () => {
  const root = new FakeEl('div');
  let clicked = null;
  const row = { market: 'KR', code: '005930', name: '삼성', quote: null };
  renderBoard(root, { id: 'g', name: 'x', rows: [row] }, { onChart: (r) => { clicked = r; } });
  const link = root.find('name-link');
  assert.ok(link, 'onChart 있으면 name-link 버튼 생성');
  link.click();
  assert.equal(clicked, row, '클릭 시 해당 종목으로 콜백');
});

test('renderBoard: onChart 없으면 name-plain (클릭 불가)', () => {
  const root = new FakeEl('div');
  renderBoard(root, { id: 'g', name: 'x', rows: [
    { market: 'KR', code: '005930', name: '삼성', quote: null },
  ] }, {});
  assert.ok(!root.find('name-link'), 'name-link 없음');
  assert.ok(root.find('name-plain'), 'name-plain 사용');
});

test('renderBoard: onChart 있으면 현재가가 클릭 가능한 버튼(price-chart-btn) + 클릭 시 row 콜백', () => {
  const root = new FakeEl('div');
  let clicked = null;
  const row = { market: 'KR', code: '005930', name: '삼성',
    quote: { price: 349000, change: 32000, changePct: 10, volume: 1, tradingValue: 1, approxTradingValue: false } };
  renderBoard(root, { id: 'g', name: 'x', rows: [row] }, { onChart: (r) => { clicked = r; } });
  const btn = root.find('price-chart-btn');
  assert.ok(btn, 'onChart 있으면 price-chart-btn 버튼 생성');
  assert.equal(btn.title, '차트 보기', '버튼 title');
  assert.ok(btn.allText().includes('349,000'), '버튼에 현재가 표시');
  btn.click();
  assert.equal(clicked, row, '현재가 클릭 시 해당 종목으로 콜백');
});

test('renderBoard: onChart 없으면 현재가는 plain td (버튼 없음)', () => {
  const root = new FakeEl('div');
  renderBoard(root, { id: 'g', name: 'x', rows: [
    { market: 'KR', code: '005930', name: '삼성',
      quote: { price: 349000, change: 1, changePct: 1, volume: 1, tradingValue: 1, approxTradingValue: false } },
  ] }, {});
  assert.ok(!root.find('price-chart-btn'), 'price-chart-btn 없음');
  assert.ok(root.allText().includes('349,000'), '현재가는 plain 텍스트로 표시');
});

// --- memo row ---

test('renderBoard: memo row — colspan 셀 + inline input, blur 시 (row, index, text) 저장 콜백', () => {
  const root = new FakeEl('div');
  let edited = null;
  const memo = { type: 'memo', id: 'm1', text: '반도체' };
  renderBoard(root, { id: 'g', name: 'x', rows: [
    { market: 'KR', code: '005930', name: '삼성', quote: null },
    memo,
  ] }, { onEditMemo: (row, i, text) => { edited = { row, i, text }; } });
  assert.ok(root.find('memo-row'), 'memo-row tr 생성');
  const td = root.find('memo-cell');
  assert.equal(td.colSpan, 6, '시세 컬럼 전체를 colspan으로 합침');
  const input = root.find('memo-input');
  assert.ok(input, 'inline input 생성');
  assert.equal(input.value, '반도체', '기존 텍스트 표시');
  input.value = '수정된 메모';
  input.blur();
  assert.deepEqual(edited, { row: memo, i: 1, text: '수정된 메모' }, 'blur 시 콜백');
});

test('renderBoard: memo row — Enter 입력 완료 시 저장하고 같은 값은 중복 저장하지 않음', () => {
  const root = new FakeEl('div');
  const edits = [];
  const memo = { type: 'memo', id: 'm1', text: '기존' };
  renderBoard(root, { id: 'g', name: 'x', rows: [memo] }, {
    onEditMemo: (row, i, text) => edits.push({ row, i, text }),
  });
  const input = root.find('memo-input');
  input.value = '엔터 저장';
  input.dispatch('keydown', { key: 'Enter', preventDefault: () => { input.prevented = true; } });
  input.blur();
  assert.equal(input.prevented, true, 'Enter 기본 동작 방지');
  assert.deepEqual(edits, [{ row: memo, i: 0, text: '엔터 저장' }], 'Enter 저장 후 blur 중복 저장 없음');
});

test('renderBoard: 빈 text memo row도 렌더 (input 빈값)', () => {
  const root = new FakeEl('div');
  renderBoard(root, { id: 'g', name: 'x', rows: [
    { type: 'memo', id: 'm1', text: '' },
  ] }, { onEditMemo: () => {} });
  const input = root.find('memo-input');
  assert.ok(input, '빈 memo도 행 렌더');
  assert.equal(input.value, '');
});

test('renderBoard: onEditMemo 없으면 memo는 읽기 전용 텍스트', () => {
  const root = new FakeEl('div');
  renderBoard(root, { id: 'g', name: 'x', rows: [
    { type: 'memo', id: 'm1', text: '표시만' },
  ] }, {});
  assert.ok(!root.find('memo-input'), 'input 없음');
  assert.ok(root.find('memo-text'), '읽기 전용 span');
  assert.ok(root.allText().includes('표시만'));
});

// --- 행 이동/삭제 ---

test('renderBoard: onReorderRow — stock/memo 모두 drag 가능, drop 시 (fromIndex, toIndex)', () => {
  const root = new FakeEl('div');
  const calls = [];
  renderBoard(root, { id: 'g', name: 'x', rows: [
    { market: 'KR', code: 'A', name: 'a', quote: null },
    { type: 'memo', id: 'm', text: '' },
    { market: 'KR', code: 'B', name: 'b', quote: null },
  ] }, { onReorderRow: (from, to) => calls.push([from, to]) });
  const memoCell = root.find('memo-cell');
  assert.equal(memoCell.colSpan, 7, 'memo row는 actions 열까지 포함해 한 행 전체를 채움');
  assert.ok(root.find('board-memo-line'), 'full-width memo line wrapper');
  const handles = root.findAll('drag-handle');
  assert.equal(handles.length, 3, '모든 행(stock+memo)에 drag handle');
  const rows = root.findAll('board-row');
  const store = {};
  const dataTransfer = {
    setData: (k, v) => { store[k] = v; },
    getData: (k) => store[k],
  };
  rows[0].dispatch('dragstart', { dataTransfer });
  rows[2].dispatch('dragover', { preventDefault: () => { store.prevented = true; }, dataTransfer });
  rows[2].dispatch('drop', { preventDefault: () => { store.dropPrevented = true; }, dataTransfer });
  assert.equal(store.prevented, true, 'dragover preventDefault');
  assert.equal(store.dropPrevented, true, 'drop preventDefault');
  assert.deepEqual(calls, [[0, 2]], '(fromIndex, toIndex) 콜백');
});

test('renderBoard: onReorderRow만 있어도 actions 헤더 열 + drag handle 추가', () => {
  const root = new FakeEl('div');
  renderBoard(root, { id: 'g', name: 'x', rows: [
    { market: 'KR', code: 'A', name: 'a', quote: null },
  ] }, { onReorderRow: () => {} });
  assert.ok(root.find('actions'), 'actions 셀 존재');
  assert.ok(root.find('drag-handle'), 'drag handle 존재');
  assert.ok(!root.find('remove'), 'onRemove 없으면 삭제 버튼 없음');
});

test('renderBoard: onRemove — stock/memo 행 모두 삭제 버튼, 클릭 시 (row, index)', () => {
  const root = new FakeEl('div');
  const removed = [];
  const memo = { type: 'memo', id: 'm', text: '' };
  const stock = { market: 'KR', code: 'A', name: 'a', quote: null };
  renderBoard(root, { id: 'g', name: 'x', rows: [stock, memo] },
    { onRemove: (row, i) => removed.push({ row, i }) });
  const btns = root.findAll('remove');
  assert.equal(btns.length, 2, 'stock+memo 모두 삭제 버튼');
  btns[1].click();
  btns[0].click();
  assert.deepEqual(removed, [{ row: memo, i: 1 }, { row: stock, i: 0 }], '(row, index) 콜백');
});

test('renderBoard: 기존 onChart 흐름 유지 — memo 행 섞여도 stock 행 차트 클릭 동작', () => {
  const root = new FakeEl('div');
  let clicked = null;
  const stock = { market: 'KR', code: '005930', name: '삼성', quote: null };
  renderBoard(root, { id: 'g', name: 'x', rows: [
    { type: 'memo', id: 'm', text: '메모' },
    stock,
  ] }, { onChart: (r) => { clicked = r; } });
  root.find('name-link').click();
  assert.equal(clicked, stock, 'memo가 있어도 stock 차트 콜백 유지');
});
