import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFredObservations, parseStooqCsv, ecosTimeToDate, parseEcosRows,
  cleanPoints, normalizeMacro, hasData,
} from '../functions/api/_macro-core.js';

test('parseFredObservations: 결측(.) 제외, 숫자 변환', () => {
  const json = { observations: [
    { date: '2026-03-20', value: '4.25' },
    { date: '2026-03-21', value: '.' },
    { date: '2026-03-22', value: '4.25' },
  ] };
  assert.deepEqual(parseFredObservations(json), [
    { date: '2026-03-20', value: 4.25 },
    { date: '2026-03-22', value: 4.25 },
  ]);
});

test('parseStooqCsv: Close 컬럼 추출', () => {
  const csv = 'Date,Open,High,Low,Close,Volume\n2026-06-11,98.0,98.5,97.9,98.21,0\n2026-06-12,98.2,98.6,98.0,98.40,0';
  assert.deepEqual(parseStooqCsv(csv), [
    { date: '2026-06-11', value: 98.21 },
    { date: '2026-06-12', value: 98.4 },
  ]);
  assert.deepEqual(parseStooqCsv('No data'), []);
});

test('ecosTimeToDate: 월·분기·연·일 변환', () => {
  assert.equal(ecosTimeToDate('202605'), '2026-05-01'); // 월
  assert.equal(ecosTimeToDate('2026Q1'), '2026-03-01'); // 분기(말 월)
  assert.equal(ecosTimeToDate('20263'), '2026-09-01'); // 분기 대체표기
  assert.equal(ecosTimeToDate('20260331'), '2026-03-31'); // 일
  assert.equal(ecosTimeToDate('2026'), '2026-01-01'); // 연
  assert.equal(ecosTimeToDate('bad'), null);
});

test('parseEcosRows: row → 오름차순 포인트, RESULT면 throw', () => {
  const json = { StatisticSearch: { row: [
    { TIME: '202604', DATA_VALUE: '4045' },
    { TIME: '202603', DATA_VALUE: '4092' },
  ] } };
  assert.deepEqual(parseEcosRows(json), [
    { date: '2026-03-01', value: 4092 },
    { date: '2026-04-01', value: 4045 },
  ]);
  assert.throws(() => parseEcosRows({ RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다' } }), /ECOS 오류/);
});

test('cleanPoints: 유효값만, 오름차순, 최대 개수', () => {
  const pts = [{ date: '2026-02-01', value: 2 }, { date: '2026-01-01', value: 1 }, { date: 'x', value: 9 }];
  assert.deepEqual(cleanPoints(pts), [{ date: '2026-01-01', value: 1 }, { date: '2026-02-01', value: 2 }]);
  assert.equal(cleanPoints([{ date: '2026-01-01', value: 1 }, { date: '2026-02-01', value: 2 }], 1).length, 1);
});

test('hasData: 포인트 있으면 true', () => {
  assert.equal(hasData({ series: [{ points: [] }, { points: [{ date: '2026-01-01', value: 1 }] }] }), true);
  assert.equal(hasData({ series: [{ points: [] }] }), false);
});

test('normalizeMacro: 스키마 정규화, seed 플래그', () => {
  const out = normalizeMacro({ collectedAt: 'T', seed: true, indicators: [
    { key: 'dxy', label: '달러인덱스', series: [{ name: 'DXY', points: [{ date: '2026-01-01', value: 98.1 }] }] },
  ] });
  assert.equal(out.seed, true);
  assert.equal(out.indicators[0].decimals, 2); // 기본값
  assert.equal(out.indicators[0].series[0].points.length, 1);
});
