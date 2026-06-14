import { test } from 'node:test';
import assert from 'node:assert/strict';

// 최소 DOM 스텁 — macro.js 렌더를 브라우저 없이 실행.
// createElementNS/setAttribute 미제공 → svgEl이 createElement 폴백 + attr 스킵(가드 검증).
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

const {
  renderMacro, latestPoint, prevPoint, changeOf, fmtNum, fmtChange, changeTone, sparklinePoints,
} = await import('./macro.js');

function sampleData() {
  return {
    seed: true,
    indicators: [
      { key: 'dxy', label: '달러인덱스', unit: '', decimals: 2, source: 'Stooq',
        series: [{ name: 'DXY', points: [{ date: '2026-06-01', value: 98.1 }, { date: '2026-06-08', value: 97.95 }, { date: '2026-06-12', value: 98.21 }] }] },
      { key: 'kr_st', label: '한국 단기외채비중·비율', unit: '%', decimals: 1, source: 'ECOS',
        series: [
          { name: '단기외채비중', points: [{ date: '2025-09-01', value: 22.8 }, { date: '2025-12-01', value: 23.0 }] },
          { name: '단기외채비율', points: [{ date: '2025-09-01', value: 39.0 }, { date: '2025-12-01', value: 39.4 }] },
        ] },
    ],
  };
}

// --- 순수 헬퍼 ---

test('latestPoint/prevPoint: 유효 포인트만, 순서대로', () => {
  const pts = [{ date: 'a', value: 1 }, { date: 'b', value: null }, { date: 'c', value: 3 }];
  assert.equal(latestPoint(pts).value, 3);
  assert.equal(prevPoint(pts).value, 1);
  assert.equal(latestPoint([]), null);
  assert.equal(prevPoint([{ date: 'a', value: 1 }]), null);
});

test('changeOf: 최신 − 직전, 부족하면 null', () => {
  assert.equal(changeOf([{ date: 'a', value: 10 }, { date: 'b', value: 12.5 }]), 2.5);
  assert.equal(changeOf([{ date: 'a', value: 10 }]), null);
});

test('fmtNum/fmtChange: 자리수·부호', () => {
  assert.equal(fmtNum(1234.5, 0), '1,235');
  assert.equal(fmtNum(98.2, 2), '98.20');
  assert.equal(fmtNum(null), '—');
  assert.equal(fmtChange(2.5, 1), '+2.5');
  assert.equal(fmtChange(-2.5, 1), '−2.5');
  assert.equal(fmtChange(0, 2), '0.00');
});

test('changeTone: 한국식 톤', () => {
  assert.equal(changeTone(1), 'up');
  assert.equal(changeTone(-1), 'down');
  assert.equal(changeTone(0), 'flat');
  assert.equal(changeTone(null), 'flat');
});

test('sparklinePoints: 좌표열 계산, 포인트<2면 빈 문자열', () => {
  assert.equal(sparklinePoints([{ value: 1 }]), '');
  // 값 [10,20,30], 기본 w116 h30 pad3 → innerW110 innerH24, span20
  const s = sparklinePoints([{ value: 10 }, { value: 20 }, { value: 30 }]);
  assert.equal(s, '3,27 58,15 113,3');
});

// --- 렌더 ---

test('renderMacro: 지표 카드 수 = indicators 길이, 라벨 표시', () => {
  const root = new FakeEl('div');
  renderMacro(root, { data: sampleData() });
  assert.equal(root.findByClass('macro-card').length, 2);
  const text = root.allText();
  assert.ok(text.includes('달러인덱스'));
  assert.ok(text.includes('한국 단기외채비중·비율'));
});

test('renderMacro: 시리즈 줄 수 = 시리즈 합, 최신값·기준일 표시', () => {
  const root = new FakeEl('div');
  renderMacro(root, { data: sampleData() });
  assert.equal(root.findByClass('macro-srow').length, 3); // 1 + 2
  const text = root.allText();
  assert.ok(text.includes('98.21'), '달러인덱스 최신값');
  assert.ok(text.includes('39.4'), '단기외채비율 최신값');
  assert.ok(text.includes('기준일 2026-06-12'), 'DXY 기준일');
});

test('renderMacro: seed 데이터면 안내 배너', () => {
  const root = new FakeEl('div');
  renderMacro(root, { data: sampleData() });
  assert.equal(root.findByClass('macro-notice').length, 1);
});

test('renderMacro: 빈 데이터 → 안내 문구', () => {
  const root = new FakeEl('div');
  renderMacro(root, { data: { indicators: [] } });
  assert.ok(root.allText().includes('데이터가 없습니다'));
  renderMacro(root, { data: null });
  assert.ok(root.allText().includes('데이터가 없습니다'));
});
