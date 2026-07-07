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
  removeEventListener(type, fn) {
    if (!this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter((f) => f !== fn);
  }
  dispatch(type, event) {
    for (const fn of (this._listeners[type] || []).slice()) fn(event);
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

// 컬럼 리사이즈 드래그는 window에 mousemove/mouseup를 붙인다 → fake window 제공.
globalThis.window = new FakeEl('window');

// localStorage 스텁 — 컬럼 폭 저장/복원 검증용.
function makeFakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
  };
}
globalThis.localStorage = makeFakeStorage();

const { renderTrades } = await import('./trades.js');

// 헬퍼: 특정 헤더 텍스트의 th 찾기.
function findHeader(root, text) {
  return root.findAll('th').find((t) => t._text === text);
}
// 헬퍼: th에 붙은 리사이즈 핸들 찾기.
function resizeHandleOf(th) {
  return th ? th.children.find((c) => (c.className || '').split(/\s+/).includes('col-resize-handle')) : undefined;
}

// 샘플 state
function sampleState() {
  return {
    data: {
      updatedAt: '2026-06-19T12:00:00Z',
      days: {
        '2026-06-19': {
          journal: '오늘은 좋았다',
          resultTag: 'success',
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
          resultTag: 'failure',
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

// ---------- 날짜별 성공/실패 태그 ----------

test('renderTrades: 날짜 옆 결과 태그 select 렌더 (없음/성공/실패)', () => {
  const root = new FakeEl('div');
  renderTrades(root, sampleState(), {});
  const selects = root.findAll('select').filter((s) => (s.className || '').split(/\s+/).includes('trades-result-tag'));
  // 날짜 2개 → 태그 select 2개
  assert.equal(selects.length, 2, '날짜별 결과 태그 select 존재');
  // 옵션 텍스트에 없음/성공/실패 포함
  const optText = selects[0].allText();
  assert.ok(optText.includes('없음'), '없음 옵션');
  assert.ok(optText.includes('성공'), '성공 옵션');
  assert.ok(optText.includes('실패'), '실패 옵션');
});

test('renderTrades: 현재 resultTag가 select 값/클래스에 반영', () => {
  const root = new FakeEl('div');
  renderTrades(root, sampleState(), {});
  const selects = root.findAll('select').filter((s) => (s.className || '').split(/\s+/).includes('trades-result-tag'));
  const successSel = selects.find((s) => s.value === 'success');
  const failureSel = selects.find((s) => s.value === 'failure');
  assert.ok(successSel, 'success 값 select 존재');
  assert.ok((successSel.className || '').split(/\s+/).includes('success'), 'success 클래스 적용');
  assert.ok(failureSel, 'failure 값 select 존재');
  assert.ok((failureSel.className || '').split(/\s+/).includes('failure'), 'failure 클래스 적용');
});

test('renderTrades: 태그 변경 → onResultTag(date, value) 호출 + 클래스 갱신', () => {
  const root = new FakeEl('div');
  const captured = [];
  renderTrades(root, sampleState(), {
    onResultTag: (date, resultTag) => captured.push({ date, resultTag }),
  });
  const selects = root.findAll('select').filter((s) => (s.className || '').split(/\s+/).includes('trades-result-tag'));
  const successSel = selects.find((s) => s.value === 'success'); // 2026-06-19
  successSel.value = 'failure';
  successSel.dispatch('change');
  assert.equal(captured.length, 1);
  assert.equal(captured[0].date, '2026-06-19');
  assert.equal(captured[0].resultTag, 'failure');
  // 변경된 값의 클래스가 갱신됨(success 제거, failure 부여)
  const cls = (successSel.className || '').split(/\s+/);
  assert.ok(cls.includes('failure'), 'failure 클래스로 갱신');
  assert.ok(!cls.includes('success'), 'success 클래스 제거');
});

test('renderTrades: 태그 없음("") 선택 → 중립(색 클래스 없음)', () => {
  const root = new FakeEl('div');
  const captured = [];
  renderTrades(root, sampleState(), {
    onResultTag: (date, resultTag) => captured.push({ date, resultTag }),
  });
  const selects = root.findAll('select').filter((s) => (s.className || '').split(/\s+/).includes('trades-result-tag'));
  const successSel = selects.find((s) => s.value === 'success');
  successSel.value = '';
  successSel.dispatch('change');
  assert.equal(captured[0].resultTag, '');
  const cls = (successSel.className || '').split(/\s+/);
  assert.ok(!cls.includes('success') && !cls.includes('failure'), '색 클래스 없음(중립)');
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

// ---------- 컬럼 리사이즈 ----------

test('renderTrades: 보유일 이후 컬럼 헤더에 resize handle 렌더', () => {
  globalThis.localStorage.clear();
  const root = new FakeEl('div');
  renderTrades(root, sampleState(), {});
  for (const h of ['보유일', '매매이유', '테마태그']) {
    const th = findHeader(root, h);
    assert.ok(th, `${h} 헤더 존재`);
    assert.ok((th.className || '').split(/\s+/).includes('resizable'), `${h} 헤더 resizable 클래스`);
    assert.ok(resizeHandleOf(th), `${h} 헤더에 resize handle`);
  }
});

test('renderTrades: 보유일 이전 컬럼에는 resize handle 없음', () => {
  globalThis.localStorage.clear();
  const root = new FakeEl('div');
  renderTrades(root, sampleState(), {});
  for (const h of ['코드', '종목명', '매수평균', '매도평균', '수량', '손익', '수익률', '전날종가']) {
    const th = findHeader(root, h);
    assert.ok(th, `${h} 헤더 존재`);
    assert.ok(!(th.className || '').split(/\s+/).includes('resizable'), `${h} 헤더 non-resizable`);
    assert.ok(!resizeHandleOf(th), `${h} 헤더에 handle 없음`);
  }
});

test('renderTrades: handle 드래그 → 컬럼 width 변경 + localStorage 저장', () => {
  globalThis.localStorage.clear();
  const root = new FakeEl('div');
  renderTrades(root, sampleState(), {});
  const th = findHeader(root, '보유일');
  const handle = resizeHandleOf(th);
  assert.ok(handle, '보유일 handle 존재');

  // 초기 폭 미설정 → 기본 fallback(120px)에서 +80px 드래그
  let prevented = false;
  handle.dispatch('mousedown', { clientX: 200, preventDefault: () => { prevented = true; } });
  assert.ok(prevented, 'mousedown에서 preventDefault 호출');
  globalThis.window.dispatch('mousemove', { clientX: 280 });
  globalThis.window.dispatch('mouseup', { clientX: 280 });

  assert.equal(th.style.width, '200px', 'th width 200px (120 + 80)');
  const saved = JSON.parse(globalThis.localStorage.getItem('bigboard.trades.colWidths.v1'));
  assert.equal(saved['보유일'], 200, 'localStorage에 보유일 폭 저장');
});

test('renderTrades: 저장된 width가 다음 renderTrades에서 적용', () => {
  globalThis.localStorage.clear();
  globalThis.localStorage.setItem('bigboard.trades.colWidths.v1', JSON.stringify({ 매매이유: 320 }));
  const root = new FakeEl('div');
  renderTrades(root, sampleState(), {});
  // 여러 날짜 테이블 모두 동일 저장 폭 적용되어야 함
  const ths = root.findAll('th').filter((t) => t._text === '매매이유');
  assert.ok(ths.length >= 2, '매매이유 헤더가 날짜별로 존재');
  for (const th of ths) {
    assert.equal(th.style.width, '320px', '저장된 폭 적용');
    assert.equal(th.style.minWidth, '320px', 'minWidth도 적용');
  }
});

test('renderTrades: 드래그 최소 폭 클램프(60px 미만 방지)', () => {
  globalThis.localStorage.clear();
  const root = new FakeEl('div');
  renderTrades(root, sampleState(), {});
  const th = findHeader(root, '테마태그');
  const handle = resizeHandleOf(th);
  // 기본 120px에서 -400px 드래그 → 최소 60px로 클램프
  handle.dispatch('mousedown', { clientX: 500, preventDefault: () => {} });
  globalThis.window.dispatch('mouseup', { clientX: 100 });
  assert.equal(th.style.width, '60px', '최소 폭 60px 클램프');
});
