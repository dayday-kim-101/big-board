// restore-jaelyo-manual 코어 테스트 — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STRUCTURED_FIELDS,
  restoreManual,
  restoreBoard,
} from './restore-jaelyo-manual-core.js';

test('STRUCTURED_FIELDS: notes를 제외한 구조화 7필드', () => {
  assert.deepEqual(STRUCTURED_FIELDS, [
    'newOrExisting', 'theme', 'material', 'materialPersistence',
    'materialContinuity', 'financials', 'supplyDemand',
  ]);
  assert.ok(!STRUCTURED_FIELDS.includes('notes'), 'notes는 복구 대상 아님');
});

test('restoreManual: old의 사용자값이 current seed보다 우선하여 복원됨', () => {
  // old엔 사용자가 작성한 theme/material, current엔 seed가 덮어쓴 값
  const oldManual = { theme: '방산', material: '사용자 원문 재료' };
  const current = { theme: '자동 seed 테마', material: '자동 seed 재료' };
  const { manual, restored } = restoreManual(oldManual, current);
  assert.equal(manual.theme, '방산', 'old 사용자값 복원');
  assert.equal(manual.material, '사용자 원문 재료', 'old 사용자값 복원');
  assert.deepEqual(restored.sort(), ['material', 'theme']);
});

test('restoreManual: old가 빈 필드였던 seed-filled 값은 빈 값으로 초기화됨', () => {
  // old는 전부 빈값(사용자 미작성), current는 seed로 채워짐
  const oldManual = {};
  const current = {
    theme: 'seed 테마', material: 'seed 재료',
    materialContinuity: 'seed 세계영향', supplyDemand: 'seed 국내수급',
  };
  const { manual, reset, restored } = restoreManual(oldManual, current);
  assert.equal(manual.theme, '', 'seed 초기화');
  assert.equal(manual.material, '', 'seed 초기화');
  assert.equal(manual.materialContinuity, '', 'seed 초기화');
  assert.equal(manual.supplyDemand, '', 'seed 초기화');
  assert.deepEqual(reset.sort(), ['material', 'materialContinuity', 'supplyDemand', 'theme']);
  assert.equal(restored.length, 0, '복원할 사용자값 없음');
});

test('restoreManual: notes(자유 메모)는 current 값을 유지', () => {
  const oldManual = { theme: '방산' }; // old엔 notes 없음
  const current = { theme: 'seed', notes: '팝업에서 새로 쓴 자유 메모\n둘째 줄' };
  const { manual } = restoreManual(oldManual, current);
  assert.equal(manual.theme, '방산', '구조화 필드는 old로 복원');
  assert.equal(manual.notes, '팝업에서 새로 쓴 자유 메모\n둘째 줄', 'notes는 current 유지');
});

test('restoreManual: old와 current가 같은 값이면 카운트 없이 유지', () => {
  const same = { theme: '반도체', material: 'HBM' };
  const { manual, restored, reset } = restoreManual(same, same);
  assert.equal(manual.theme, '반도체');
  assert.equal(manual.material, 'HBM');
  assert.equal(restored.length, 0);
  assert.equal(reset.length, 0);
});

test('restoreManual: 반환 manual은 항상 8키(구조화 7 + notes)', () => {
  const { manual } = restoreManual({}, {});
  assert.deepEqual(Object.keys(manual).sort(), [
    'financials', 'material', 'materialContinuity', 'materialPersistence',
    'newOrExisting', 'notes', 'supplyDemand', 'theme',
  ]);
});

test('restoreBoard: code 기준 대조 — 복원/초기화/notes 보존 종합', () => {
  const oldBoard = {
    date: '2026-06-16',
    rows: [
      { code: 'A', name: '에이', manual: { newOrExisting: '신규', theme: '방산', material: '사용자 재료' } },
      { code: 'B', name: '비', manual: {} }, // old 빈값
    ],
  };
  const currentBoard = {
    date: '2026-06-16',
    rows: [
      { code: 'A', name: '에이', manual: { newOrExisting: '신규', theme: 'seed덮음', material: '사용자 재료', notes: 'A메모' } },
      { code: 'B', name: '비', manual: { theme: 'seed테마', supplyDemand: 'seed수급' } }, // seed로 채워짐
    ],
  };
  const { board, restoredCount, resetCount, rowsTouched } = restoreBoard(oldBoard, currentBoard);
  // A: theme만 old로 복원(seed덮음→방산), newOrExisting/material은 이미 동일
  assert.equal(board.rows[0].manual.theme, '방산', 'A theme 복원');
  assert.equal(board.rows[0].manual.notes, 'A메모', 'A notes 보존');
  // B: seed 초기화
  assert.equal(board.rows[1].manual.theme, '', 'B seed 초기화');
  assert.equal(board.rows[1].manual.supplyDemand, '', 'B seed 초기화');
  assert.equal(restoredCount, 1, 'A.theme 복원 1건');
  assert.equal(resetCount, 2, 'B.theme + B.supplyDemand 초기화 2건');
  assert.equal(rowsTouched, 2, 'A,B 모두 변경');
});

test('restoreBoard: old에 없는 code는 구조화 필드 전부 초기화(사용자 데이터 없음)', () => {
  const oldBoard = { rows: [] }; // old엔 아무 종목도 없음
  const currentBoard = {
    rows: [{ code: 'X', name: '엑스', manual: { theme: 'seed', material: 'seed', notes: 'X메모' } }],
  };
  const { board, resetCount } = restoreBoard(oldBoard, currentBoard);
  assert.equal(board.rows[0].manual.theme, '', 'seed 초기화');
  assert.equal(board.rows[0].manual.material, '', 'seed 초기화');
  assert.equal(board.rows[0].manual.notes, 'X메모', 'notes는 보존');
  assert.equal(resetCount, 2);
});

test('restoreBoard: null old 보드(기준 커밋에 파일 없음) → 안전하게 초기화', () => {
  const currentBoard = { rows: [{ code: 'Y', manual: { theme: 'seed' } }] };
  const { board, resetCount } = restoreBoard(null, currentBoard);
  assert.equal(board.rows[0].manual.theme, '');
  assert.equal(resetCount, 1);
});
