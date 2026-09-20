import { test } from 'node:test';
import assert from 'node:assert/strict';

class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.className = '';
    this._text = '';
    this._listeners = {};
    this.value = '';
    this.href = '';
    this.target = '';
    this.rel = '';
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

const { renderPolicyBriefing } = await import('./policy-briefing.js');

function sampleReport() {
  return {
    date: '2026-09-16',
    title: '일일 정책·투자 브리핑 — 2026-09-16 백필',
    summary: '모델 provider 연결 실패로 누락되어 백필했다.',
    topIndustries: [
      { rank: 1, name: '금리·환율 민감 수출/반도체', score: 76, reason: 'Fed 결정 전 금리 전망이 핵심 변수.', koreaConnection: '반도체·자동차 확인 필요.' },
      { rank: 2, name: 'AI 데이터센터·전력 인프라', score: 72, reason: '전력 수요 뉴스 유지.', koreaConnection: '변압기·전선 관심 유지.' },
    ],
    changes: { us: 'Fed 결정 전 금리 전망 부상.', global: 'BOJ 불확실성.', korea: '신규 고신뢰 정책 신호 제한적.' },
    risks: ['RSS/재인용 비중이 높음.'],
    sources: [{ label: 'Reuters: Fed와 금리전망', url: 'https://example.com/reuters' }],
  };
}

test('renderPolicyBriefing: Top 산업, 변화, 리스크, 직관적 출처 링크 렌더', () => {
  const root = new FakeEl('div');
  renderPolicyBriefing(root, { dates: ['2026-09-16'], selectedDate: '2026-09-16', report: sampleReport() });
  const text = root.allText();
  assert.ok(text.includes('정책브리핑'));
  assert.ok(text.includes('금리·환율 민감 수출/반도체'));
  assert.ok(text.includes('76/100'));
  assert.ok(text.includes('미국: Fed 결정 전 금리 전망 부상.'));
  assert.ok(text.includes('RSS/재인용 비중이 높음.'));
  assert.ok(text.includes('Reuters: Fed와 금리전망'));
  assert.equal(root.findByClass('policy-rank-item').length, 2);
  assert.equal(root.findByClass('policy-source-link')[0].href, 'https://example.com/reuters');
});

test('renderPolicyBriefing: report 없으면 안내 문구', () => {
  const root = new FakeEl('div');
  renderPolicyBriefing(root, { dates: [], report: null });
  assert.ok(root.allText().includes('정책브리핑 데이터를 불러오지 못했습니다'));
});
