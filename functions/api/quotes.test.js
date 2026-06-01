import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNaverKR, parseYahoo } from './_quotes-core.js';

// 실제 응답에서 추출한 최소 픽스처

const naverUp = {
  datas: [
    {
      itemCode: '005930',
      stockName: '삼성전자',
      closePriceRaw: '349000',
      compareToPreviousClosePriceRaw: '32000',
      compareToPreviousPrice: { code: '2', text: '상승' },
      fluctuationsRatioRaw: '10.09',
      accumulatedTradingVolumeRaw: '39372103',
      accumulatedTradingValueRaw: '13440623000000',
      currencyType: { code: 'KRW' },
    },
  ],
};

const naverDown = {
  datas: [
    {
      stockName: '에코프로비엠',
      closePriceRaw: '207000',
      compareToPreviousClosePriceRaw: '-10000',
      compareToPreviousPrice: { code: '5', text: '하락' },
      fluctuationsRatioRaw: '-4.61',
      accumulatedTradingVolumeRaw: '1234567',
      accumulatedTradingValueRaw: '255000000000',
    },
  ],
};

const yahooUS = {
  chart: { result: [{ meta: { symbol: 'AAPL', regularMarketPrice: 312.06, chartPreviousClose: 312.51, regularMarketVolume: 70026752, shortName: 'Apple Inc.', currency: 'USD' } }] },
};

test('KR 해피패스: 6필드 + 실제 거래대금, 상승', () => {
  const q = parseNaverKR(naverUp, '005930');
  assert.equal(q.market, 'KR');
  assert.equal(q.name, '삼성전자');
  assert.equal(q.price, 349000);
  assert.equal(q.change, 32000);
  assert.equal(q.changePct, 10.09);
  assert.equal(q.volume, 39372103);
  assert.equal(q.tradingValue, 13440623000000);
  assert.equal(q.approxTradingValue, false);
  assert.ok(q.change > 0, '상승은 양수 change');
});

test('KR 하락: change/pct 음수 부호 보존', () => {
  const q = parseNaverKR(naverDown, '247540');
  assert.equal(q.change, -10000);
  assert.equal(q.changePct, -4.61);
  assert.ok(q.change < 0, '하락은 음수 change');
});

test('KR 엣지: 빈 datas → throw', () => {
  assert.throws(() => parseNaverKR({ datas: [] }, '000000'), /빈 응답/);
});

test('US 해피패스: change 계산 + 거래대금 근사 플래그', () => {
  const q = parseYahoo(yahooUS, { market: 'US', code: 'AAPL' });
  assert.equal(q.name, 'Apple Inc.');
  assert.equal(q.price, 312.06);
  assert.equal(q.change, round(312.06 - 312.51, 4)); // 음수
  assert.ok(q.change < 0);
  assert.equal(q.changePct, round(((312.06 - 312.51) / 312.51) * 100, 2));
  assert.equal(q.volume, 70026752);
  assert.equal(q.tradingValue, Math.round(312.06 * 70026752));
  assert.equal(q.approxTradingValue, true, 'US 거래대금은 근사');
});

test('US 엣지: meta 없음 → throw', () => {
  assert.throws(() => parseYahoo({ chart: { result: [] } }, { market: 'US', code: 'X' }), /메타 없음/);
});

test('KR 콤마 포함 문자열 폴백 파싱', () => {
  const q = parseNaverKR({ datas: [{ stockName: 'T', closePrice: '349,000', fluctuationsRatio: '1.5', accumulatedTradingValue: '13,440,623' }] }, 'T');
  assert.equal(q.price, 349000);
  assert.equal(q.changePct, 1.5);
  assert.equal(q.tradingValue, 13440623);
});

function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
