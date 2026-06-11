import { test } from 'node:test';
import assert from 'node:assert/strict';

// 최소 DOM 스텁 — jaelyo.js 렌더 로직을 브라우저 없이 실행. select/input value·change 지원.
class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.className = '';
    this.title = '';
    this.type = '';
    this.value = '';
    this._text = '';
    this._listeners = {};
  }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  get textContent() { return this._text; }
  set innerHTML(v) { this.children = []; this._text = ''; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.children.push(c); }
  addEventListener(type, fn) { this._listeners[type] = fn; }
  dispatch(type) { this._listeners[type]?.(); }
  click() { this.dispatch('click'); }
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
globalThis.document = { createElement: (t) => new FakeEl(t) };

const { renderJaelyo } = await import('./jaelyo.js');

function sampleBoard() {
  return {
    date: '2026-05-07',
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
  dateSelect.value = '2026-05-07';
  dateSelect.dispatch('change');
  assert.equal(picked, '2026-05-07');
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
