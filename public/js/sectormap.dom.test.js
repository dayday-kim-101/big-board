import { test } from 'node:test';
import assert from 'node:assert/strict';

// 최소 DOM 스텁 — macro.dom.test.js 패턴. 섹터맵은 인라인 style을 쓰므로 style 객체만 추가.
class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.className = '';
    this.style = {};
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

const { renderSectorMap, squarify, tileBg, fmtCapTrillion } = await import('./sectormap.js');

function sampleSectors() {
  return [
    { name: '반도체', totalCapTrillion: 1558.5, companies: [
      { name: '삼성전자', code: '005930', capTrillion: 400.2, desc: '메모리 반도체' },
      { name: 'SK하이닉스', code: '000660', capTrillion: 150.1, desc: 'HBM' },
    ] },
    { name: '이차전지', totalCapTrillion: 200, companies: [
      { name: 'LG에너지솔루션', code: '373220', capTrillion: 80, desc: '배터리 셀' },
    ] },
  ];
}

// quotes 키는 "MARKET:CODE". 373220은 시세 없음 → 중립 톤 검증용.
function sampleQuotes() {
  return {
    'KR:005930': { market: 'KR', code: '005930', price: 70000, change: 1500, changePct: 2.5, ok: true },
    'KR:000660': { market: 'KR', code: '000660', price: 200000, change: -2500, changePct: -1.2, ok: true },
  };
}

// --- 순수 헬퍼 ---

test('squarify: 면적 = 가중치 비례, 전체 합 = 영역 넓이', () => {
  const weights = [6, 3, 1];
  const rects = squarify(weights, 0, 0, 100, 50);
  const areas = rects.map((r) => r.w * r.h);
  const total = areas.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 100 * 50) < 1e-6);
  assert.ok(Math.abs(areas[0] / areas[1] - 2) < 1e-6); // 6:3 = 2:1
  assert.ok(Math.abs(areas[1] / areas[2] - 3) < 1e-6); // 3:1
});

test('squarify: 모든 사각형이 주어진 영역 안', () => {
  const rects = squarify([9, 5, 4, 3, 2, 1], 10, 20, 160, 90);
  for (const r of rects) {
    assert.ok(r.x >= 10 - 1e-6 && r.y >= 20 - 1e-6);
    assert.ok(r.x + r.w <= 10 + 160 + 1e-6);
    assert.ok(r.y + r.h <= 20 + 90 + 1e-6);
    assert.ok(r.w > 0 && r.h > 0);
  }
});

test('squarify: 가중치 합 0 또는 영역 0이면 빈 사각형', () => {
  for (const r of squarify([0, 0], 0, 0, 100, 100)) assert.equal(r.w * r.h, 0);
  for (const r of squarify([1, 2], 0, 0, 0, 100)) assert.equal(r.w * r.h, 0);
});

test('tileBg: 상승=빨강, 하락=파랑, 보합/시세없음=중립', () => {
  assert.ok(tileBg(1.5).startsWith('rgba(255, 77, 79,'));
  assert.ok(tileBg(-1.5).startsWith('rgba(77, 123, 255,'));
  assert.equal(tileBg(0), 'rgba(194, 200, 212, 0.08)');
  assert.equal(tileBg(null), 'rgba(194, 200, 212, 0.08)');
});

test('tileBg: |등락률| 3%에서 농도 캡', () => {
  assert.equal(tileBg(3), tileBg(10));
  assert.equal(tileBg(-3), tileBg(-25));
  assert.notEqual(tileBg(1), tileBg(3));
});

test('fmtCapTrillion: 천 단위 구분·조 표기, 비숫자는 —', () => {
  assert.equal(fmtCapTrillion(1558.5), '1,558.5조');
  assert.equal(fmtCapTrillion(80), '80조');
  assert.equal(fmtCapTrillion(null), '—');
});

// --- 렌더 (getBoundingClientRect 없음 → 1600x900 가상 캔버스로 배치) ---

test('renderSectorMap: 섹터 헤더 수 = sectors 길이, 이름·시총 표시', () => {
  const root = new FakeEl('div');
  renderSectorMap(root, { sectors: sampleSectors(), quotes: sampleQuotes() });
  assert.equal(root.findByClass('sectormap-sector-head').length, 2);
  const text = root.allText();
  assert.ok(text.includes('반도체'));
  assert.ok(text.includes('1,558.5조'));
  assert.ok(text.includes('이차전지'));
});

test('renderSectorMap: 타일 수 = 종목 합, 큰 시총 순 배치, 이름·시총 표시', () => {
  const root = new FakeEl('div');
  renderSectorMap(root, { sectors: sampleSectors(), quotes: sampleQuotes() });
  const tiles = root.findByClass('sectormap-tile');
  assert.equal(tiles.length, 3);
  const text = root.allText();
  assert.ok(text.includes('삼성전자'));
  assert.ok(text.includes('400.2조'));
  // 첫 타일(삼성전자, 시총 최대)의 면적이 두 번째(SK하이닉스)보다 크다
  const area = (t) => parseFloat(t.style.width) * parseFloat(t.style.height);
  assert.ok(area(tiles[0]) > area(tiles[1]));
});

test('renderSectorMap: 시세 톤 — 상승 up, 하락 down, 시세 없음 na(등락률 줄 없음)', () => {
  const root = new FakeEl('div');
  renderSectorMap(root, { sectors: sampleSectors(), quotes: sampleQuotes() });
  const tiles = root.findByClass('sectormap-tile');
  assert.ok(tiles[0].className.split(/\s+/).includes('up')); // 삼성전자 +2.5%
  assert.ok(tiles[1].className.split(/\s+/).includes('down')); // SK하이닉스 -1.2%
  assert.ok(tiles[2].className.split(/\s+/).includes('na')); // LG엔솔 시세 없음
  assert.equal(root.findByClass('sectormap-tile-pct').length, 2); // 시세 있는 타일만 등락률 표시
  assert.ok(root.allText().includes('+2.50%'));
});

test('renderSectorMap: 인라인 style — px 절대좌표 + 배경색=등락률, 사업내용 툴팁', () => {
  const root = new FakeEl('div');
  renderSectorMap(root, { sectors: sampleSectors(), quotes: sampleQuotes() });
  const tiles = root.findByClass('sectormap-tile');
  for (const t of tiles) {
    assert.ok(t.style.left.endsWith('px') && t.style.top.endsWith('px'));
    assert.ok(parseFloat(t.style.width) > 0 && parseFloat(t.style.height) > 0);
  }
  assert.equal(tiles[0].style.background, tileBg(2.5));
  assert.equal(tiles[2].style.background, tileBg(null)); // 시세 없음 → 중립
  assert.ok(tiles[0].title.includes('메모리 반도체')); // 사업내용 툴팁
});

test('renderSectorMap: quotes 비어도 렌더 — 전 타일 중립 톤', () => {
  const root = new FakeEl('div');
  renderSectorMap(root, { sectors: sampleSectors(), quotes: {} });
  const tiles = root.findByClass('sectormap-tile');
  assert.equal(tiles.length, 3);
  for (const t of tiles) assert.ok(t.className.split(/\s+/).includes('na'));
  assert.equal(root.findByClass('sectormap-tile-pct').length, 0);
});

// --- 요약 패널 (hover/클릭) ---

function fire(elm, type) { elm._listeners[type] && elm._listeners[type](); }

test('패널: 섹터 hover → 열림(open), 전체 종목·시총·등락률 나열', () => {
  const root = new FakeEl('div');
  renderSectorMap(root, { sectors: sampleSectors(), quotes: sampleQuotes() });
  const sectors = root.findByClass('sectormap-sector');
  const panel = root.findByClass('sectormap-panel')[0];
  assert.ok(panel);
  assert.ok(!panel.className.includes('open')); // 초기엔 닫힘
  fire(sectors[0], 'mouseenter'); // 반도체(시총 최대라 첫 번째)
  assert.ok(panel.className.includes('open'));
  assert.ok(!panel.className.includes('pinned'));
  const text = panel.allText();
  assert.ok(text.includes('반도체'));
  assert.ok(text.includes('2종목'));
  assert.ok(text.includes('삼성전자'));
  assert.ok(text.includes('SK하이닉스')); // 작은 타일도 패널엔 전부 표시
  assert.ok(text.includes('메모리 반도체')); // 사업내용
  assert.ok(text.includes('+2.50%'));
  assert.equal(panel.findByClass('sectormap-panel-row').length, 2);
});

test('패널: 맵 mouseleave → 닫힘(고정 안 된 경우)', () => {
  const root = new FakeEl('div');
  renderSectorMap(root, { sectors: sampleSectors(), quotes: sampleQuotes() });
  const map = root.findByClass('sectormap-map')[0];
  const panel = root.findByClass('sectormap-panel')[0];
  fire(root.findByClass('sectormap-sector')[0], 'mouseenter');
  assert.ok(panel.className.includes('open'));
  fire(map, 'mouseleave');
  assert.ok(!panel.className.includes('open'));
});

test('패널: 클릭 → 고정(pinned), 고정 중 다른 섹터 hover 무시, 재클릭·✕로 해제', () => {
  const root = new FakeEl('div');
  renderSectorMap(root, { sectors: sampleSectors(), quotes: sampleQuotes() });
  const sectors = root.findByClass('sectormap-sector');
  const panel = root.findByClass('sectormap-panel')[0];
  fire(sectors[0], 'click');
  assert.ok(panel.className.includes('pinned'));
  assert.ok(panel.allText().includes('삼성전자'));
  fire(sectors[1], 'mouseenter'); // 고정 중 hover 무시
  assert.ok(panel.allText().includes('삼성전자'));
  fire(sectors[1], 'click'); // 다른 섹터 클릭 → 전환
  assert.ok(panel.allText().includes('LG에너지솔루션'));
  fire(sectors[1], 'click'); // 재클릭 → 해제
  assert.ok(!panel.className.includes('open'));
  fire(sectors[0], 'click'); // ✕ 버튼으로도 해제
  const close = panel.findByClass('sectormap-panel-close')[0];
  assert.ok(close);
  fire(close, 'click');
  assert.ok(!panel.className.includes('open'));
});

test('renderSectorMap: 섹터 없음/시총 전부 0 → 안내 문구', () => {
  const root = new FakeEl('div');
  renderSectorMap(root, { sectors: [], quotes: {} });
  assert.ok(root.allText().includes('섹터 데이터가 없습니다'));
  renderSectorMap(root, {});
  assert.ok(root.allText().includes('섹터 데이터가 없습니다'));
  renderSectorMap(root, { sectors: [{ name: 'X', companies: [{ name: 'A', code: '1', capTrillion: 0 }] }] });
  assert.ok(root.allText().includes('섹터 데이터가 없습니다'));
});
