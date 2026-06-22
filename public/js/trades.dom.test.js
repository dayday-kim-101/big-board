import { test } from 'node:test';
import assert from 'node:assert/strict';

// 최소 DOM 스텁 — trades.js 렌더 로직을 브라우저 없이 실행.
// jaelyo.dom.test.js와 동일한 FakeEl 하네스 패턴.
class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.className = '';
    this.title = '';
    this.type = '';
    this.value = '';
    this.rows = 0;
    this.min = '';
    this.placeholder = '';
    this.disabled = false;
    this._text = '';
    this._html = '';
    this._listeners = {};
    this.style = {};
  }
  set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  get textContent() { return this._text; }
  set innerHTML(v) { this.children = []; this._text = ''; this._html = v; }
  get innerHTML() { return this._html; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.children.push(c); }
  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }
  dispatch(type, event) {
    for (const fn of (this._listeners[type] || [])) fn(event);
  }
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

// Date.prototype.toISOString 스텁 (붙여넣기 모달 오늘 날짜 기본값 생성에 필요)
globalThis.document = { createElement: (t) => new FakeEl(t) };

const { renderTrades } = await import('./trades.js');

// 샘플 state
function sampleState() {
  return {
    data: {
      updatedAt: '2026-06-19T12:00:00Z',
      days: {
        '2026-06-19': {
          journal: '오늘은 좋았다',
          records: [
            {
              code: '001820', name: '삼화콘덴서', market: 'KR',
              buyAvg: 183700, sellAvg: 165200, qty: 3,
              buyAmount: 551100, sellAmount: 495600,
              fee: 1140, pnl: -56640, returnPct: -10.28,
              prevClose: 183700, holdDays: 0,
              reason: '기술적 반등', tags: ['MLCC'],
            },
            {
              code: '005930', name: '삼성전자', market: 'KR',
              buyAvg: 82000, sellAvg: 85000, qty: 10,
              buyAmount: 820000, sellAmount: 850000,
              fee: 500, pnl: 29500, returnPct: 3.60,
              prevClose: 81000, holdDays: 1,
              reason: '', tags: [],
            },
          ],
        },
        '2026-06-18': {
          journal: '',
          records: [
            {
              code: '000660', name: 'SK하이닉스', market: 'KR',
              buyAvg: 200000, sellAvg: 210000, qty: 2,
              buyAmount: 400000, sellAmount: 420000,
              fee: 600, pnl: 19400, returnPct: 4.85,
              prevClose: 195000, holdDays: 0,
              reason: '', tags: ['반도체'],
            },
          ],
        },
      },
    },
  };
}

test('renderTrades: 상단 통계 카드 렌더', () => {
  const root = new FakeEl('div');
  renderTrades(root, sampleState(), {});
  const text = root.allText();
  assert.ok(text.includes('매매횟수'), '매매횟수 레이블');
  assert.ok(text.includes('승률'), '승률 레이블');
  assert.ok(text.includes('누적손익'), '누적손익 레이블');
  assert.ok(text.includes('평균수익률'), '평균수익률 레이블');
  // 3건 중 2승 (삼성전자 3.6%, SK하이닉스 4.85%) → 승률 66.7%
  assert.ok(text.includes('3'), '매매횟수 값');
});

test('renderTrades: 통계 카드 클래스 포함', () => {
  const root = new FakeEl('div');
  renderTrades(root, sampleState(), {});
  const classes = root.collectClasses();
  assert.ok(classes.includes('trades-stats'), 'trades-stats 컨테이너');
  assert.ok(classes.includes('trades-stat-card'), 'trades-stat-card');
});

test('renderTrades: 날짜별 테이블 최신순 렌더', () => {
  const root = new FakeEl('div');
  renderTrades(root, sampleState(), {});
  const text = root.allText();
  // 6/19가 6/18보다 먼저 나타나야 함
  assert.ok(text.indexOf('2026-06-19') < text.indexOf('2026-06-18'), '최신 날짜 먼저');
});

test('renderTrades: 종목 행 표시 확인', () => {
  const root = new FakeEl('div');
  renderTrades(root, sampleState(), {});
  const text = root.allText();
  assert.ok(text.includes('삼화콘덴서'), '삼화콘덴서 종목명');
  assert.ok(text.includes('삼성전자'), '삼성전자 종목명');
  assert.ok(text.includes('SK하이닉스'), 'SK하이닉스 종목명');
});

test('renderTrades: 손익/수익률 색 클래스(priceTone) 적용', () => {
  const root = new FakeEl('div');
  renderTrades(root, sampleState(), {});
  const classes = root.collectClasses();
  // 삼화콘덴서 pnl < 0 → down, 삼성전자 pnl > 0 → up
  assert.ok(classes.includes('up'), 'up 클래스(수익)');
  assert.ok(classes.includes('down'), 'down 클래스(손실)');
});

test('renderTrades: 매매이유/테마태그 인라인 입력 존재', () => {
  const root = new FakeEl('div');
  renderTrades(root, sampleState(), {});
  const inputs = root.findAll('input');
  const reasonInputs = inputs.filter((i) => i.placeholder === '매매이유');
  const tagsInputs = inputs.filter((i) => i.placeholder === '태그1, 태그2');
  assert.ok(reasonInputs.length > 0, '매매이유 input 존재');
  assert.ok(tagsInputs.length > 0, '테마태그 input 존재');
});

test('renderTrades: 매매이유 변경 → onManual 호출', () => {
  const root = new FakeEl('div');
  const captured = [];
  renderTrades(root, sampleState(), {
    onManual: (date, code, manual) => captured.push({ date, code, manual }),
  });
  const inputs = root.findAll('input');
  const reasonInput = inputs.find((i) => i.placeholder === '매매이유' && i.value === '기술적 반등');
  assert.ok(reasonInput, '기존값 있는 매매이유 input');
  reasonInput.value = '수정된 이유';
  reasonInput.dispatch('change');
  assert.equal(captured.length, 1);
  assert.equal(captured[0].date, '2026-06-19');
  assert.equal(captured[0].code, '001820');
  assert.deepEqual(captured[0].manual, { reason: '수정된 이유' });
});

test('renderTrades: 테마태그 변경 → onManual 호출 (배열 변환)', () => {
  const root = new FakeEl('div');
  const captured = [];
  renderTrades(root, sampleState(), {
    onManual: (date, code, manual) => captured.push({ date, code, manual }),
  });
  const inputs = root.findAll('input');
  const tagsInput = inputs.find((i) => i.placeholder === '태그1, 태그2' && i.value === 'MLCC');
  assert.ok(tagsInput, 'MLCC 태그 input');
  tagsInput.value = 'MLCC, EV';
  tagsInput.dispatch('change');
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].manual, { tags: ['MLCC', 'EV'] });
});

test('renderTrades: 일지 textarea 존재 및 onJournal 호출', () => {
  const root = new FakeEl('div');
  const captured = [];
  renderTrades(root, sampleState(), {
    onJournal: (date, journal) => captured.push({ date, journal }),
  });
  const textareas = root.findAll('textarea');
  const journalArea = textareas.find((t) => t.value === '오늘은 좋았다');
  assert.ok(journalArea, '일지 textarea 존재');
  journalArea.value = '수정된 일지';
  journalArea.dispatch('change');
  assert.equal(captured.length, 1);
  assert.equal(captured[0].date, '2026-06-19');
  assert.equal(captured[0].journal, '수정된 일지');
});

test('renderTrades: 붙여넣기 버튼 존재', () => {
  const root = new FakeEl('div');
  renderTrades(root, sampleState(), {});
  const btns = root.findAll('button');
  const pasteBtn = btns.find((b) => b._text && b._text.includes('붙여넣기'));
  assert.ok(pasteBtn, '붙여넣기 버튼 존재');
});

test('renderTrades: 데이터 없으면 빈 상태 안내', () => {
  const root = new FakeEl('div');
  renderTrades(root, { data: { days: {}, updatedAt: null } }, {});
  const text = root.allText();
  assert.ok(text.includes('매매기록이 없습니다'), '빈 상태 안내 문구');
});

test('renderTrades: state.data null이면 빈 상태', () => {
  const root = new FakeEl('div');
  renderTrades(root, { data: null }, {});
  const text = root.allText();
  assert.ok(text.includes('매매기록이 없습니다'), 'null data 빈 상태');
});
