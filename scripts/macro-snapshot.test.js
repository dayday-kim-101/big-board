import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFredObservations, parseStooqCsv, parseYahooChart, parseYahooOHLC, ecosTimeToDate, parseEcosRows,
  parseDbnomicsSeries, cleanPoints, mergePoints, normalizeMacro, normalizeIndicator, hasData,
} from '../functions/api/_macro-core.js';

test('parseYahooOHLC: OHLC 포인트, null 바 제외', () => {
  const json = { chart: { result: [{
    timestamp: [1749513600, 1749600000],
    indicators: { quote: [{ open: [99.1, null], high: [99.9, 100], low: [98.8, 99], close: [99.5, 99.7] }] },
  }], error: null } };
  const pts = parseYahooOHLC(json);
  assert.equal(pts.length, 1); // 둘째 바는 open=null → 제외
  assert.deepEqual(
    { open: pts[0].open, high: pts[0].high, low: pts[0].low, close: pts[0].close, value: pts[0].value },
    { open: 99.1, high: 99.9, low: 98.8, close: 99.5, value: 99.5 },
  );
});

test('cleanPoints: OHLC 보존, value 누락 시 close로 보정', () => {
  const pts = cleanPoints([{ date: '2026-01-05', open: 10, high: 12, low: 9, close: 11 }]);
  assert.deepEqual(pts, [{ date: '2026-01-05', value: 11, open: 10, high: 12, low: 9, close: 11 }]);
  // OHLC 불완전(low 누락)이면 레벨 포인트로 — value만 유지
  const lvl = cleanPoints([{ date: '2026-01-05', value: 5, open: 10, high: 12, close: 11 }]);
  assert.deepEqual(lvl, [{ date: '2026-01-05', value: 5 }]);
});

test('parseYahooChart: timestamp+close → 포인트, null 종가 제외', () => {
  const json = { chart: { result: [{
    timestamp: [1749513600, 1749600000, 1749686400],
    indicators: { quote: [{ close: [99.5, null, 99.75] }] },
  }], error: null } };
  const pts = parseYahooChart(json);
  assert.equal(pts.length, 2);
  assert.equal(pts[0].value, 99.5);
  assert.equal(pts[1].value, 99.75);
  assert.match(pts[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.throws(() => parseYahooChart({ chart: { error: { description: '404' } } }), /Yahoo 오류/);
});

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

test('parseDbnomicsSeries: docs[0] 병렬배열 → 오름차순 포인트', () => {
  const json = { series: { docs: [{
    period: ['2026-02', '2026-01'],
    period_start_day: ['2026-02-01', '2026-01-01'],
    value: [49.5, 51.2],
  }] } };
  assert.deepEqual(parseDbnomicsSeries(json), [
    { date: '2026-01-01', value: 51.2 },
    { date: '2026-02-01', value: 49.5 },
  ]);
});

test('parseDbnomicsSeries: NA·null·비숫자 결측 제외', () => {
  const json = { series: { docs: [{
    period_start_day: ['2026-01-01', '2026-02-01', '2026-03-01'],
    value: [50.1, 'NA', null],
  }] } };
  assert.deepEqual(parseDbnomicsSeries(json), [{ date: '2026-01-01', value: 50.1 }]);
});

test('parseDbnomicsSeries: period_start_day 없으면 period(YYYY-MM)→-01', () => {
  const json = { series: { docs: [{ period: ['2026-05'], value: [48.7] }] } };
  assert.deepEqual(parseDbnomicsSeries(json), [{ date: '2026-05-01', value: 48.7 }]);
});

test('parseDbnomicsSeries: docs 없거나 비면 throw', () => {
  assert.throws(() => parseDbnomicsSeries({ series: { docs: [] } }), /DBnomics 응답 형식 오류/);
  assert.throws(() => parseDbnomicsSeries({}), /DBnomics 응답 형식 오류/);
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

test('mergePoints: 이전∪신규 누적, 같은 날짜는 신규가 덮어씀, 오름차순', () => {
  const prev = [{ date: '2026-01-01', value: 1 }, { date: '2026-01-02', value: 2 }];
  const next = [{ date: '2026-01-02', value: 22 }, { date: '2026-01-03', value: 3 }];
  assert.deepEqual(mergePoints(prev, next), [
    { date: '2026-01-01', value: 1 },
    { date: '2026-01-02', value: 22 }, // 신규가 덮어씀
    { date: '2026-01-03', value: 3 },
  ]);
});

test('mergePoints: maxPoints로 뒤에서 자름, 잘못된 날짜 제외', () => {
  const prev = [{ date: '2026-01-01', value: 1 }, { date: 'bad', value: 9 }];
  const next = [{ date: '2026-01-02', value: 2 }, { date: '2026-01-03', value: 3 }];
  assert.deepEqual(mergePoints(prev, next, 2), [
    { date: '2026-01-02', value: 2 },
    { date: '2026-01-03', value: 3 },
  ]);
});

test('normalizeIndicator: aboveIsBad threshold 보존(belowIsBad 안 켜짐)', () => {
  const out = normalizeIndicator({
    key: 'hy_oas', label: '하이일드', category: 'crisis',
    threshold: { value: 5, aboveIsBad: true, label: '경계' },
    series: [{ name: 'HY OAS', points: [{ date: '2026-01-01', value: 6.2 }] }],
  });
  assert.deepEqual(out.threshold, { value: 5, aboveIsBad: true, label: '경계' });
  assert.equal(out.category, 'crisis');
});

test('normalizeIndicator: threshold 있으면 보존, belowIsBad 기본 true', () => {
  const out = normalizeIndicator({
    key: 'ism', label: 'ISM PMI', decimals: 1,
    threshold: { value: '50', label: '침체' },
    series: [{ name: '제조업', points: [{ date: '2026-01-01', value: 48 }] }],
  });
  assert.deepEqual(out.threshold, { value: 50, belowIsBad: true, label: '침체' });
});

test('normalizeIndicator: threshold 없으면 키 자체가 없음(기존 지표 회귀 방지)', () => {
  const out = normalizeIndicator({ key: 'dxy', label: '달러인덱스', series: [] });
  assert.equal('threshold' in out, false);
});

test('normalizeIndicator: threshold.value 비숫자면 threshold 미포함', () => {
  const out = normalizeIndicator({ key: 'x', label: 'x', threshold: { label: '침체' }, series: [] });
  assert.equal('threshold' in out, false);
});

test('normalizeMacro: 스키마 정규화, seed 플래그', () => {
  const out = normalizeMacro({ collectedAt: 'T', seed: true, indicators: [
    { key: 'dxy', label: '달러인덱스', series: [{ name: 'DXY', points: [{ date: '2026-01-01', value: 98.1 }] }] },
  ] });
  assert.equal(out.seed, true);
  assert.equal(out.indicators[0].decimals, 2); // 기본값
  assert.equal(out.indicators[0].series[0].points.length, 1);
});
