import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeList, emptyList } from './list.js';
import { normalizeEmail, emailKey } from './_github.js';

test('정규화 해피패스: 그룹·종목 보존, updatedAt 설정', () => {
  const out = normalizeList({
    groups: [
      { id: 'g1', name: '관심', tickers: [{ market: 'KR', code: '005930', name: '삼성전자' }] },
      { name: '미국', market: 'US', tickers: [{ market: 'US', code: 'AAPL', name: 'Apple' }] },
    ],
  });
  assert.equal(out.groups.length, 2);
  assert.equal(out.groups[0].tickers[0].code, '005930');
  assert.equal(out.groups[1].market, 'US');
  assert.ok(out.updatedAt, 'updatedAt 설정됨');
  assert.equal(out.groups[1].id, 'g1', '누락된 id는 인덱스로 채움'); // index 1 → "g1"
});

test('중복 종목 제거', () => {
  const out = normalizeList({
    groups: [{ name: 'x', tickers: [
      { market: 'KR', code: '005930' },
      { market: 'KR', code: '005930' },
    ] }],
  });
  assert.equal(out.groups[0].tickers.length, 1);
  assert.equal(out.groups[0].tickers[0].name, '005930', 'name 없으면 code로 채움');
});

test('빈 목록 유효', () => {
  const out = normalizeList({ groups: [] });
  assert.deepEqual(out.groups, []);
});

test('groups 배열 아니면 throw', () => {
  assert.throws(() => normalizeList({ groups: 'nope' }), /groups 배열/);
});

test('그룹 이름 누락 시 throw', () => {
  assert.throws(() => normalizeList({ groups: [{ tickers: [] }] }), /이름 누락/);
});

test('잘못된 종목 market/code 시 throw', () => {
  assert.throws(() => normalizeList({ groups: [{ name: 'x', tickers: [{ market: 'JP', code: '1' }] }] }), /market\/code/);
  assert.throws(() => normalizeList({ groups: [{ name: 'x', tickers: [{ market: 'KR' }] }] }), /market\/code/);
});

test('emptyList 모양', () => {
  assert.deepEqual(emptyList(), { groups: [], updatedAt: null });
});

test('이메일 정규화: 대소문자·공백 무시', () => {
  assert.equal(normalizeEmail('  Foo@Bar.COM '), 'foo@bar.com');
});

test('emailKey: 정규화 후 동일 이메일은 동일 키', async () => {
  const a = await emailKey('Foo@Bar.com');
  const b = await emailKey('  foo@bar.com ');
  const c = await emailKey('other@bar.com');
  assert.equal(a, b, '대소문자·공백 차이는 같은 키');
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/, 'sha256 hex');
});
