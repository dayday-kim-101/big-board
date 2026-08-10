import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportForDate, generateInterpretation, normalizeYahooSeries, pickOnOrBefore, sanitizeReport } from './_us-market-core.js';

test('normalizeYahooSeries: Yahoo chart payload를 일별 change/changePct로 정규화', () => {
  const rows = normalizeYahooSeries('NVDA', {
    chart: { result: [{ timestamp: [1785974400, 1786060800], indicators: { quote: [{ close: [100, 110], open: [99, 101], high: [111, 112], low: [98, 100], volume: [1, 2] }] } }] },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].date, '2026-08-07');
  assert.equal(rows[1].change, 10);
  assert.equal(rows[1].changePct, 10);
});

test('pickOnOrBefore: 휴장일이면 직전 거래일 row를 선택', () => {
  const rows = [{ date: '2026-06-18', close: 1 }, { date: '2026-06-22', close: 2 }];
  assert.equal(pickOnOrBefore(rows, '2026-06-19').date, '2026-06-18');
  assert.equal(pickOnOrBefore(rows, '2026-06-22').date, '2026-06-22');
});

test('buildReportForDate: 요청 항목과 상승/하락 섹터를 생성', () => {
  const symbols = ['^GSPC', '^IXIC', '^RUT', 'NVDA', '^SOX', '^TNX', 'XLK', 'XLF', 'XLU'];
  const seriesBySymbol = Object.fromEntries(symbols.map((s, i) => [s, [
    { date: '2026-08-06', close: 100, change: null, changePct: null },
    { date: '2026-08-07', close: 100 + i, change: i, changePct: i },
  ]]));
  const report = buildReportForDate({ date: '2026-08-07', seriesBySymbol, collectedAt: 'x' });
  assert.equal(report.indices.length, 3);
  assert.equal(report.focus.length, 2);
  assert.equal(report.rates[0].key, 'us10y');
  assert.ok(report.sectors.rising.length >= 1);
  assert.match(report.interpretation, /S&P500/);
});

test('sanitizeReport: 메모/해석을 보존하고 섹터 상위 5개 제한', () => {
  const report = sanitizeReport({ date: '2026-08-07', memo: 'm', interpretation: 'i', sectors: { rising: Array.from({ length: 7 }, (_, i) => ({ key: `k${i}`, label: `L${i}`, close: 1, changePct: i })) } });
  assert.equal(report.memo, 'm');
  assert.equal(report.interpretation, 'i');
  assert.equal(report.sectors.rising.length, 5);
});

test('generateInterpretation: 핵심 지표 문장을 생성', () => {
  const s = generateInterpretation({ indices: [{ key: 'sp500', changePct: 1 }, { key: 'nasdaq', changePct: 2 }, { key: 'russell2000', changePct: 0.5 }], focus: [{ key: 'nvidia', changePct: 3 }, { key: 'sox', changePct: 2 }], rates: [{ key: 'us10y', close: 4.2 }], sectors: { rising: [{ label: '기술' }], falling: [{ label: '에너지' }] } });
  assert.match(s, /나스닥 \+2.00%/);
  assert.match(s, /10년물 4.200%/);
});
