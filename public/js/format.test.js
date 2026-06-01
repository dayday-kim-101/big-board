import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  priceTone, fmtPrice, fmtSigned, fmtPct, fmtVolume, fmtTradingValue, mergeBoard,
} from './format.js';

test('priceTone: 상승/하락/보합/없음', () => {
  assert.equal(priceTone(32000), 'up');
  assert.equal(priceTone(-10000), 'down');
  assert.equal(priceTone(0), 'flat');
  assert.equal(priceTone(null), 'na');
});

test('fmtPrice: KR 정수, US 소수 2자리', () => {
  assert.equal(fmtPrice(349000, 'KR'), '349,000');
  assert.equal(fmtPrice(312.06, 'US'), '312.06');
  assert.equal(fmtPrice(null, 'KR'), '—');
});

test('fmtSigned: 부호 표시', () => {
  assert.equal(fmtSigned(32000, 'KR'), '+349,000'.replace('349,000', '32,000'));
  assert.equal(fmtSigned(-10000, 'KR'), '−10,000');
  assert.equal(fmtSigned(0, 'KR'), '0');
});

test('fmtPct', () => {
  assert.equal(fmtPct(10.09), '+10.09%');
  assert.equal(fmtPct(-4.61), '−4.61%');
  assert.equal(fmtPct(null), '—');
});

test('fmtVolume', () => {
  assert.equal(fmtVolume(39372103), '39,372,103');
  assert.equal(fmtVolume(null), '—');
});

test('fmtTradingValue: KR 조/억, US compact', () => {
  assert.equal(fmtTradingValue(13440623000000, 'KR'), '13.44조');
  assert.equal(fmtTradingValue(255000000000, 'KR'), '2,550억');
  assert.equal(fmtTradingValue(21852548229, 'US'), '$21.9B');
  assert.equal(fmtTradingValue(null, 'KR'), '—');
});

test('mergeBoard: 그룹·종목에 시세 병합, 없으면 null', () => {
  const list = { groups: [{ id: 'g0', name: '관심', tickers: [
    { market: 'KR', code: '005930', name: '삼성전자' },
    { market: 'US', code: 'AAPL', name: 'Apple' },
  ] }] };
  const quotes = { 'KR:005930': { price: 349000, change: 32000 } };
  const out = mergeBoard(list, quotes);
  assert.equal(out.length, 1);
  assert.equal(out[0].rows.length, 2);
  assert.equal(out[0].rows[0].quote.price, 349000);
  assert.equal(out[0].rows[1].quote, null, '시세 없는 종목은 null');
});

test('mergeBoard: 빈 목록 안전', () => {
  assert.deepEqual(mergeBoard({ groups: [] }, {}), []);
  assert.deepEqual(mergeBoard(null, null), []);
});
