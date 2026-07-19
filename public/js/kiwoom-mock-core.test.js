import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runKiwoomMock } from './kiwoom-mock-core.js';

const base = {
  market: 'KR',
  symbol: '005930',
  name: '삼성전자',
  buyPrice: 70000,
  buyQuantity: 5,
  sellPrice: 73000,
  sellQuantity: 5,
  unfilledTimeoutSec: 5,
  maxOrderAmountKrw: 10_000_000,
};

test('runKiwoomMock: 매수 체결 후 매도까지 정상 시나리오', () => {
  const result = runKiwoomMock({ ...base, scenario: 'buy_then_sell' });
  assert.equal(result.ok, true);
  assert.equal(result.orders.length, 2);
  assert.equal(result.orders[0].side, 'BUY');
  assert.equal(result.orders[0].status, 'FILLED');
  assert.equal(result.orders[1].side, 'SELL');
  assert.equal(result.orders[1].status, 'FILLED');
  assert.equal(result.summary.buyComplete, true);
  assert.equal(result.summary.sellComplete, true);
  assert.equal(result.summary.filledBuyQty, 5);
  assert.equal(result.summary.filledSellQty, 5);
});

test('runKiwoomMock: 미체결 주문은 타임아웃 후 취소', () => {
  const result = runKiwoomMock({ ...base, scenario: 'unfilled_cancel' });
  assert.equal(result.orders.length, 1);
  assert.equal(result.orders[0].status, 'CANCELED');
  assert.equal(result.summary.canceledCount, 1);
  assert.ok(result.journal.some((e) => e.event === 'order_canceled'));
});

test('runKiwoomMock: 부분체결 후 잔량 취소와 재주문', () => {
  const result = runKiwoomMock({ ...base, buyQuantity: 5, scenario: 'partial_fill' });
  assert.equal(result.orders.length, 2);
  assert.equal(result.orders[0].status, 'CANCELED');
  assert.equal(result.orders[0].filledQuantity, 2);
  assert.equal(result.orders[1].quantity, 3);
  assert.equal(result.summary.filledBuyQty, 2);
});

test('runKiwoomMock: kill switch는 주문을 차단', () => {
  const result = runKiwoomMock({ ...base, scenario: 'kill_switch' });
  assert.equal(result.orders.length, 0);
  assert.equal(result.summary.blockedCount, 1);
  assert.ok(result.journal.some((e) => e.event === 'order_blocked'));
});

test('runKiwoomMock: 입력 검증', () => {
  const result = runKiwoomMock({ buyPrice: 1, buyQuantity: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('종목을 선택하세요.'));
});
