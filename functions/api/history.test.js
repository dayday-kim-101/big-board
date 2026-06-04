import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNaverHistory, parseYahooHistory } from './_history-core.js';

// 네이버 siseJson은 작은따옴표 헤더 + 큰따옴표 데이터의 JS 배열 리터럴
const naverText = `
 [['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율'],
["20260401", 179000, 190800, 178000, 189600, 32390251, 48.43],
["20260402", 192600, 193600, 175000, 178400, 38615231, 48.4]]`;

test('parseNaverHistory: 헤더 제외, 날짜 변환, OHLC 숫자', () => {
  const c = parseNaverHistory(naverText);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0], { time: '2026-04-01', open: 179000, high: 190800, low: 178000, close: 189600, volume: 32390251 });
  assert.equal(c[1].time, '2026-04-02');
  assert.equal(c[1].close, 178400);
});

test('parseNaverHistory: 깨진 입력 → 빈 배열', () => {
  assert.deepEqual(parseNaverHistory('<html>error</html>'), []);
  assert.deepEqual(parseNaverHistory(''), []);
});

test('parseYahooHistory: timestamp+OHLC → 캔들, 휴장일(null) 제외', () => {
  const json = {
    chart: { result: [{
      timestamp: [1711929600, 1712016000], // 두 번째는 null 데이터
      indicators: { quote: [{
        open: [100, null], high: [110, null], low: [95, null], close: [105, null], volume: [1000, null],
      }] },
    }] },
  };
  const c = parseYahooHistory(json);
  assert.equal(c.length, 1, 'null 캔들 제외');
  assert.match(c[0].time, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual({ o: c[0].open, h: c[0].high, l: c[0].low, cl: c[0].close, v: c[0].volume }, { o: 100, h: 110, l: 95, cl: 105, v: 1000 });
});

test('parseYahooHistory: 빈/이상 입력 안전', () => {
  assert.deepEqual(parseYahooHistory({}), []);
  assert.deepEqual(parseYahooHistory({ chart: { result: [{}] } }), []);
});
