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

test('memo row 정규화: stock+memo 혼합 순서 보존, 빈 text 유지, id 자동 생성', () => {
  const out = normalizeList({
    groups: [{ name: 'x', tickers: [
      { market: 'KR', code: '005930', name: '삼성전자' },
      { type: 'memo', id: 'm1', text: '── 반도체 ──' },
      { type: 'memo', text: '' },
      { market: 'US', code: 'AAPL' },
    ] }],
  });
  const t = out.groups[0].tickers;
  assert.equal(t.length, 4, 'stock 2 + memo 2 모두 보존');
  assert.equal(t[0].code, '005930');
  assert.deepEqual(t[1], { type: 'memo', id: 'm1', text: '── 반도체 ──' });
  assert.equal(t[2].type, 'memo');
  assert.equal(t[2].text, '', '빈 text 보존');
  assert.ok(t[2].id, 'id 누락 시 자동 생성');
  assert.equal(t[3].code, 'AAPL', '혼합 순서 보존');
});

test('memo row 방어: 알 수 없는 type 제거, 비문자열 text는 빈 문자열', () => {
  const out = normalizeList({
    groups: [{ name: 'x', tickers: [
      { type: 'divider', text: '버림' },
      { type: 'memo', text: 123 },
      { type: 'memo', text: null },
    ] }],
  });
  const t = out.groups[0].tickers;
  assert.equal(t.length, 2, '알 수 없는 type만 제거');
  assert.equal(t[0].text, '');
  assert.equal(t[1].text, '');
  assert.notEqual(t[0].id, t[1].id, '자동 생성 id는 서로 다름');
});

test('memo row는 중복 제거 대상 아님 — 같은 text여도 모두 보존', () => {
  const out = normalizeList({
    groups: [{ name: 'x', tickers: [
      { type: 'memo', id: 'a', text: '' },
      { type: 'memo', id: 'b', text: '' },
    ] }],
  });
  assert.equal(out.groups[0].tickers.length, 2);
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
