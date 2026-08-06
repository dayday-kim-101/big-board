import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDirDates, isValidDate } from './korea-market.js';

test('korea-market parseDirDates: 날짜 json만 내림차순', () => {
  const items = [
    { name: '2026-08-05.json' },
    { name: 'notes.json' },
    { name: '2026-06-11.json' },
    { name: '2026-07-01.json' },
    { name: '_dates.json' },
  ];
  assert.deepEqual(parseDirDates(items), ['2026-08-05', '2026-07-01', '2026-06-11']);
});

test('korea-market isValidDate: YYYY-MM-DD만 허용', () => {
  assert.equal(isValidDate('2026-08-05'), true);
  assert.equal(isValidDate('20260805'), false);
  assert.equal(isValidDate('../2026-08-05'), false);
});
