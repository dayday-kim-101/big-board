// jaelyo-snapshot 순수 헬퍼 테스트 — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kstDateString, pickPrevDate, enumerateDates } from './jaelyo-snapshot.mjs';

test('kstDateString: UTC → KST(+9) 날짜', () => {
  // 2026-05-07 06:40 UTC = 2026-05-07 15:40 KST (같은 날)
  assert.equal(kstDateString(new Date('2026-05-07T06:40:00Z')), '2026-05-07');
  // 2026-05-07 16:00 UTC = 2026-05-08 01:00 KST (다음 날로 넘어감)
  assert.equal(kstDateString(new Date('2026-05-07T16:00:00Z')), '2026-05-08');
  // 2026-05-06 15:30 UTC = 2026-05-07 00:30 KST
  assert.equal(kstDateString(new Date('2026-05-06T15:30:00Z')), '2026-05-07');
});

test('pickPrevDate: today 미만 최신 날짜', () => {
  const dates = ['2026-05-09', '2026-05-08', '2026-05-07'];
  assert.equal(pickPrevDate(dates, '2026-05-09'), '2026-05-08');
  assert.equal(pickPrevDate(dates, '2026-05-08'), '2026-05-07');
});

test('pickPrevDate: 이전 날짜 없음 → null', () => {
  assert.equal(pickPrevDate(['2026-05-07'], '2026-05-07'), null);
  assert.equal(pickPrevDate([], '2026-05-07'), null);
  assert.equal(pickPrevDate(['2026-05-10'], '2026-05-07'), null);
});

test('enumerateDates: from~to 모든 달력일 오름차순(월 경계 포함)', () => {
  assert.deepEqual(enumerateDates('2026-05-07', '2026-05-09'), ['2026-05-07', '2026-05-08', '2026-05-09']);
  assert.deepEqual(enumerateDates('2026-04-30', '2026-05-01'), ['2026-04-30', '2026-05-01']);
  assert.deepEqual(enumerateDates('2026-05-07', '2026-05-07'), ['2026-05-07']);
});

test('enumerateDates: 잘못된 범위 → []', () => {
  assert.deepEqual(enumerateDates('2026-05-09', '2026-05-07'), []);
  assert.deepEqual(enumerateDates('', '2026-05-07'), []);
});
