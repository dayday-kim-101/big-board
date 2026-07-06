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
