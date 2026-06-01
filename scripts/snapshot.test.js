import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectTickers } from './snapshot.mjs';

test('여러 사용자 종목 합집합 — 중복 없음', () => {
  const users = [
    { groups: [{ name: 'a', tickers: [{ market: 'KR', code: '005930' }, { market: 'US', code: 'AAPL' }] }] },
    { groups: [{ name: 'b', tickers: [{ market: 'KR', code: '005930' }, { market: 'US', code: 'TSLA' }] }] },
  ];
  const out = collectTickers(users);
  assert.equal(out.length, 3); // 005930, AAPL, TSLA (005930 중복 제거)
  const keys = out.map((t) => `${t.market}:${t.code}`).sort();
  assert.deepEqual(keys, ['KR:005930', 'US:AAPL', 'US:TSLA']);
});

test('사용자 0명 → 빈 배열', () => {
  assert.deepEqual(collectTickers([]), []);
});

test('빈 그룹/누락 필드 안전 처리', () => {
  const users = [
    { groups: [] },
    {},
    { groups: [{ name: 'x', tickers: [{ market: 'KR' }, { code: '005930' }, { market: 'KR', code: '000660' }] }] },
  ];
  const out = collectTickers(users);
  assert.deepEqual(out, [{ market: 'KR', code: '000660' }]); // 불완전 항목 제외
});
