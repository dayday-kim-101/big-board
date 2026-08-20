import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.className = '';
    this._text = '';
    this._listeners = {};
  }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  get textContent() { return this._text; }
  set innerHTML(v) { this.children = []; this._text = ''; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.children.push(c); }
  addEventListener(type, fn) { this._listeners[type] = fn; }
  allText() {
    let t = this._text || '';
    for (const c of this.children) t += ' ' + c.allText();
    return t.trim();
  }
  findByClass(cls, acc = []) {
    if (this.className.split(/\s+/).includes(cls)) acc.push(this);
    for (const c of this.children) c.findByClass(cls, acc);
    return acc;
  }
}
globalThis.document = { createElement: (t) => new FakeEl(t) };

const { renderKoreaMarket } = await import('./korea-market.js');

const T = 1_000_000_000_000;
function sampleReport() {
  return {
    date: '2026-08-20', memo: '', indices: [], markets: [], foreignerTop: [], foreignerSellTop: [],
    investorFlows: {
      windows: [5, 10, 20], asOf: '2026-08-20', sampleDays: 7,
      markets: [
        { key: 'KOSPI', label: '코스피', flows: {
          personal: [
            { window: 5, days: 5, total: 1.23 * T, average: 0.246 * T, complete: true },
            { window: 10, days: 7, total: 2 * T, average: (2 / 7) * T, complete: false },
            { window: 20, days: 0, total: null, average: null, complete: false },
          ],
          foreign: [
            { window: 5, days: 5, total: -1.5 * T, average: -0.3 * T, complete: true },
            { window: 10, days: 7, total: -2 * T, average: (-2 / 7) * T, complete: false },
            { window: 20, days: 0, total: null, average: null, complete: false },
          ],
          institution: [
            { window: 5, days: 5, total: 0, average: 0, complete: true },
            { window: 10, days: 7, total: 0, average: 0, complete: false },
            { window: 20, days: 0, total: null, average: null, complete: false },
          ],
        } },
        { key: 'KOSDAQ', label: '코스닥', flows: {
          personal: [{ window: 5, days: 5, total: 0.5 * T, average: 0.1 * T, complete: true }],
          foreign: [{ window: 5, days: 5, total: -0.5 * T, average: -0.1 * T, complete: true }],
          institution: [{ window: 5, days: 5, total: 0, average: 0, complete: true }],
        } },
      ],
    },
  };
}

test('renderKoreaMarket: 누적 수급 표에 KOSPI/KOSDAQ, 투자자 행, 5/10/20일 열', () => {
  const root = new FakeEl('div');
  renderKoreaMarket(root, { dates: ['2026-08-20'], selectedDate: '2026-08-20', report: sampleReport() });
  const box = root.findByClass('krm-flow-box')[0];
  assert.ok(box, 'krm-flow-box 존재');
  const text = box.allText();
  for (const s of ['코스피', '코스닥', '개인', '외국인', '기관', '5일 누적 / 평균', '10일 누적 / 평균', '20일 누적 / 평균']) {
    assert.ok(text.includes(s), `${s} 표시`);
  }
  assert.equal(box.findByClass('krm-flow-market').length, 2);
});

test('renderKoreaMarket: 셀은 누적/평균 조 단위 2자리, 부족분은 n일 기준·데이터 부족', () => {
  const root = new FakeEl('div');
  renderKoreaMarket(root, { dates: ['2026-08-20'], report: sampleReport() });
  const text = root.findByClass('krm-flow-box')[0].allText();
  assert.ok(text.includes('+1.23조 / +0.25조'), '5일 누적/평균');
  assert.ok(text.includes('-1.50조 / -0.30조'), '외국인 음수 표기');
  assert.ok(text.includes('7일 기준'), '불완전 창 표기');
  assert.ok(text.includes('데이터 부족'), '집계 불가 표기');
  const cells = root.findByClass('krm-flow-cell');
  assert.ok(cells.some((c) => c.className.includes('up')));
  assert.ok(cells.some((c) => c.className.includes('down')));
});

test('renderKoreaMarket: investorFlows 없으면 미수집 안내', () => {
  const root = new FakeEl('div');
  renderKoreaMarket(root, { dates: ['2026-08-20'], report: { date: '2026-08-20', indices: [], markets: [], foreignerTop: [], foreignerSellTop: [] } });
  assert.ok(root.findByClass('krm-flow-box')[0].allText().includes('누적 수급 데이터 미수집'));
});
