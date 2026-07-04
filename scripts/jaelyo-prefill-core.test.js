// jaelyo-prefill 코어 테스트 — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthsBackCutoff,
  datesInRange,
  aggregateTopCodes,
  prefillManual,
  applySeedToBoard,
} from './jaelyo-prefill-core.js';

test('monthsBackCutoff: 최신일 기준 N개월 전 컷오프', () => {
  assert.equal(monthsBackCutoff('2026-07-03', 4), '2026-03-03');
  assert.equal(monthsBackCutoff('2026-01-15', 4), '2025-09-15');
});

test('datesInRange: [cutoff, latest] 구간만 오름차순', () => {
  const dates = ['2026-02-01', '2026-03-03', '2026-05-10', '2026-07-03', '2026-08-01'];
  assert.deepEqual(datesInRange(dates, '2026-03-03', '2026-07-03'), [
    '2026-03-03',
    '2026-05-10',
    '2026-07-03',
  ]);
});

test('aggregateTopCodes: code 기준 중복 제거 + 상위 topN만 집계', () => {
  const boards = [
    { rows: [{ code: 'A', name: '에이', rank: 1 }, { code: 'B', name: '비', rank: 2 }] },
    { rows: [{ code: 'A', name: '에이', rank: 3 }, { code: 'C', name: '씨', rank: 4 }] },
  ];
  const agg = aggregateTopCodes(boards, 100);
  // A,B,C 3종목으로 중복 제거
  assert.equal(agg.length, 3);
  const byCode = Object.fromEntries(agg.map((c) => [c.code, c]));
  assert.equal(byCode.A.appearances, 2); // 두 보드 모두 등장
  assert.equal(byCode.A.bestRank, 1); // 최고순위 보존
  assert.equal(byCode.B.appearances, 1);
});

test('aggregateTopCodes: topN 초과 행은 집계 제외', () => {
  const boards = [{ rows: [{ code: 'A', rank: 1 }, { code: 'B', rank: 2 }, { code: 'C', rank: 3 }] }];
  const agg = aggregateTopCodes(boards, 2); // 상위 2개만
  assert.deepEqual(agg.map((c) => c.code).sort(), ['A', 'B']);
});

test('prefillManual: 기존 값은 덮어쓰지 않고 빈 필드만 채움', () => {
  const existing = { theme: '반도체', material: '' }; // theme는 사용자 입력
  const seed = { theme: '로봇', material: 'HBM TC본더', supplyDemand: '국내 수급' };
  const { manual, filled } = prefillManual(existing, seed);
  assert.equal(manual.theme, '반도체'); // 기존값 보존(덮어쓰기 금지)
  assert.equal(manual.material, 'HBM TC본더'); // 빈 필드 → seed로 채움
  assert.equal(manual.supplyDemand, '국내 수급'); // 빈 필드 → seed로 채움
  assert.deepEqual(filled.sort(), ['material', 'supplyDemand']);
  assert.ok(!filled.includes('theme'));
});

test('prefillManual: seed에 없는 필드는 빈 채로 유지', () => {
  const { manual } = prefillManual({}, { theme: '원전' });
  assert.equal(manual.theme, '원전');
  assert.equal(manual.financials, ''); // seed 없음 → 그대로 빈값
  assert.equal(manual.newOrExisting, '');
});

test('applySeedToBoard: seed 있는 행의 빈 필드만 채우고 카운트 집계', () => {
  const board = {
    date: '2026-07-03',
    rows: [
      { code: 'A', name: '에이', manual: { theme: '기존테마', material: '' } },
      { code: 'B', name: '비', manual: {} },
      { code: 'Z', name: '지', manual: {} }, // seed 없음
    ],
  };
  const seed = {
    A: { theme: '무시됨', material: '재료A', supplyDemand: '수급A' },
    B: { theme: '테마B' },
  };
  const { board: out, filledCount, rowsTouched } = applySeedToBoard(board, seed);
  assert.equal(out.rows[0].manual.theme, '기존테마'); // 덮어쓰지 않음
  assert.equal(out.rows[0].manual.material, '재료A');
  assert.equal(out.rows[1].manual.theme, '테마B');
  assert.deepEqual(out.rows[2].manual, {}); // seed 없으면 무변경
  assert.equal(rowsTouched, 2); // A,B
  assert.equal(filledCount, 3); // A: material+supplyDemand, B: theme
});
