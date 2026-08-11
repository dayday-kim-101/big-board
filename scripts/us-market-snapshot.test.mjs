import test from 'node:test';
import assert from 'node:assert/strict';
import { kstDateString, parseArgs, previousKstDateString, selectSnapshotDates } from './us-market-snapshot.mjs';

test('previousKstDateString: KST 06:30 기준 전일 국내증시 날짜를 반환', () => {
  assert.equal(previousKstDateString(new Date('2026-08-10T21:30:00Z')), '2026-08-10');
  assert.equal(kstDateString(new Date('2026-08-10T21:30:00Z')), '2026-08-11');
});

test('parseArgs: --target=yesterday-kst와 dry-run 파싱', () => {
  assert.deepEqual(parseArgs(['--target=yesterday-kst', '--dry-run']), { dryRun: true, target: 'yesterday-kst', date: '' });
});

test('selectSnapshotDates: yesterday-kst가 국내증시 날짜에 있을 때 해당 날짜만 선택', () => {
  const dates = ['2026-08-08', '2026-08-10', '2026-08-11'];
  assert.deepEqual(selectSnapshotDates(dates, { target: 'yesterday-kst' }, new Date('2026-08-10T21:30:00Z')), ['2026-08-10']);
});

test('selectSnapshotDates: 대상 국내증시 날짜가 없으면 빈 배열', () => {
  const dates = ['2026-08-08', '2026-08-11'];
  assert.deepEqual(selectSnapshotDates(dates, { target: 'yesterday-kst' }, new Date('2026-08-10T21:30:00Z')), []);
});

test('selectSnapshotDates: 기본값은 전체 백필 날짜', () => {
  assert.deepEqual(selectSnapshotDates(['2026-08-11', 'bad', '2026-08-10'], {}), ['2026-08-10', '2026-08-11']);
});
