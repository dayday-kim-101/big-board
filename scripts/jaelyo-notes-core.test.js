// jaelyo notes prefill core tests — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthsBackCutoff,
  datesInRange,
  aggregateTopCodes,
  prefillNotes,
  applyNotesToBoard,
  structuredEqual,
} from './jaelyo-notes-core.js';

test('notes prefill: 최근 4개월 + 날짜별 top100 + code 중복 제거', () => {
  assert.equal(monthsBackCutoff('2026-07-03', 4), '2026-03-03');
  const dates = datesInRange(['2026-02-28', '2026-03-03', '2026-06-11', '2026-07-03'], '2026-03-03', '2026-07-03');
  assert.deepEqual(dates, ['2026-03-03', '2026-06-11', '2026-07-03']);
  const rows101 = Array.from({ length: 101 }, (_, i) => ({ code: `C${i + 1}`, name: `종목${i + 1}`, rank: i + 1 }));
  const agg = aggregateTopCodes([
    { rows: [{ code: 'A', name: '에이', rank: 1 }, { code: 'B', name: '비', rank: 2 }] },
    { rows: [{ code: 'A', name: '에이', rank: 3 }, ...rows101] },
  ], 100);
  assert.equal(agg.find((x) => x.code === 'A').appearances, 2);
  assert.ok(agg.some((x) => x.code === 'C98'), '상위 100 안 종목 포함');
  assert.ok(!agg.some((x) => x.code === 'C101'), 'top100 초과 종목 제외');
});

test('prefillNotes: notes 빈 경우만 채우고 기존 notes는 덮어쓰지 않음', () => {
  assert.deepEqual(prefillNotes({ notes: '' }, '새 메모'), {
    manual: {
      newOrExisting: '', theme: '', material: '', materialPersistence: '',
      materialContinuity: '', financials: '', supplyDemand: '', notes: '새 메모',
    },
    filled: true,
  });
  const existing = prefillNotes({ notes: '기존 메모' }, '새 메모');
  assert.equal(existing.manual.notes, '기존 메모');
  assert.equal(existing.filled, false);
});

test('applyNotesToBoard: 구조화 manual 필드는 변경하지 않고 notes만 채움', () => {
  const board = { rows: [
    { code: 'A', name: '에이', manual: { theme: '사용자테마', material: '사용자재료', supplyDemand: '사용자수급', notes: '' } },
    { code: 'B', name: '비', manual: { theme: '기존', notes: '기존 notes' } },
    { code: 'C', name: '씨', manual: { theme: '유지' } },
  ] };
  const before = JSON.parse(JSON.stringify(board));
  const { board: out, filledCount, rowsTouched } = applyNotesToBoard(board, { A: 'A notes', B: 'B new', Z: 'ignored' });
  assert.equal(filledCount, 1);
  assert.equal(rowsTouched, 1);
  assert.equal(out.rows[0].manual.notes, 'A notes');
  assert.equal(out.rows[1].manual.notes, '기존 notes');
  assert.equal(out.rows[2].manual.notes, undefined);
  assert.equal(out.rows[0].manual.theme, '사용자테마');
  assert.equal(out.rows[0].manual.material, '사용자재료');
  assert.equal(out.rows[0].manual.supplyDemand, '사용자수급');
  assert.ok(structuredEqual(before.rows[0].manual, out.rows[0].manual));
  assert.ok(structuredEqual(before.rows[1].manual, out.rows[1].manual));
});

test('applyNotesToBoard: seed가 없는 code는 manual 객체 자체를 유지', () => {
  const manual = { theme: '테마', notes: '' };
  const board = { rows: [{ code: 'X', manual }] };
  const { board: out, filledCount } = applyNotesToBoard(board, { A: 'notes' });
  assert.equal(filledCount, 0);
  assert.equal(out.rows[0].manual, manual);
});
