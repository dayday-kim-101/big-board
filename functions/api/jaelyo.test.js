// jaelyo Function 순수 헬퍼 테스트 — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDirDates, applyManualPatch, isValidDate } from './jaelyo.js';

test('isValidDate: YYYY-MM-DD만 통과', () => {
  assert.equal(isValidDate('2026-05-07'), true);
  assert.equal(isValidDate('2026-5-7'), false);
  assert.equal(isValidDate('20260507'), false);
  assert.equal(isValidDate(''), false);
  assert.equal(isValidDate(null), false);
});

test('parseDirDates: *.json만, 날짜 내림차순', () => {
  const items = [
    { name: '2026-05-07.json', type: 'file' },
    { name: '2026-05-09.json', type: 'file' },
    { name: 'README.md', type: 'file' },
    { name: 'bad.json', type: 'file' },
  ];
  const dates = parseDirDates(items);
  assert.deepEqual(dates, ['2026-05-09', '2026-05-07']);
});

test('parseDirDates: 빈/비배열 → []', () => {
  assert.deepEqual(parseDirDates([]), []);
  assert.deepEqual(parseDirDates(null), []);
});

test('applyManualPatch: 해당 code 행의 manual만 부분 병합', () => {
  const board = {
    date: '2026-05-07',
    rows: [
      { code: '028050', name: '삼성E&A', manual: { theme: '건설', material: '수주', newOrExisting: '', materialPersistence: '', materialContinuity: '', financials: '', supplyDemand: '' } },
      { code: '005930', name: '삼성전자', manual: { theme: '', material: '', newOrExisting: '', materialPersistence: '', materialContinuity: '', financials: '', supplyDemand: '' } },
    ],
  };
  const next = applyManualPatch(board, '028050', { material: '신규수주' });
  // 부분 패치: material만 갱신, theme은 보존
  assert.equal(next.rows[0].manual.material, '신규수주');
  assert.equal(next.rows[0].manual.theme, '건설');
  // 다른 행 불변
  assert.equal(next.rows[1].manual.theme, '');
  // 허용되지 않은 키 무시
  const next2 = applyManualPatch(board, '028050', { bogus: 'x', theme: '바이오' });
  assert.equal(next2.rows[0].manual.bogus, undefined);
  assert.equal(next2.rows[0].manual.theme, '바이오');
});

test('applyManualPatch: 없는 code → throw', () => {
  const board = { date: '2026-05-07', rows: [{ code: '028050', manual: {} }] };
  assert.throws(() => applyManualPatch(board, '999999', { theme: 'x' }), /종목/);
});
