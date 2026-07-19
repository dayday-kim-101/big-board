const DEFAULT_TIMEOUT_SEC = 5;
const DEFAULT_MAX_ORDER_AMOUNT = 10_000_000;

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function won(value) {
  return `${Math.round(num(value)).toLocaleString('ko-KR')}원`;
}

function makeOrder(id, symbol, side, price, quantity) {
  return {
    orderId: `MOCK-${String(id).padStart(6, '0')}`,
    symbol,
    side,
    price,
    quantity,
    filledQuantity: 0,
    status: 'PENDING',
  };
}

function record(state, event, timestamp, payload = {}) {
  state.journal.push({ event, timestamp, ...payload });
}

function timeline(state, text, level = 'info') {
  state.timeline.push({ step: state.timeline.length + 1, level, text });
}

function submit(state, { symbol, side, price, quantity, timestamp, reason }) {
  const amount = price * quantity;
  if (state.killSwitch) {
    record(state, 'order_blocked', timestamp, { symbol, side, price, quantity, reason: 'kill switch engaged' });
    timeline(state, `${side === 'BUY' ? '매수' : '매도'} 주문 차단 — kill switch`, 'warn');
    return null;
  }
  if (amount > state.maxOrderAmountKrw) {
    record(state, 'order_blocked', timestamp, { symbol, side, price, quantity, reason: `max order amount exceeded: ${amount}` });
    timeline(state, `${side === 'BUY' ? '매수' : '매도'} 주문 차단 — 주문금액 ${won(amount)} > 한도 ${won(state.maxOrderAmountKrw)}`, 'warn');
    return null;
  }
  const order = makeOrder(++state.seq, symbol, side, price, quantity);
  state.orders.push(order);
  state.activeOrder = order;
  state.activeSubmittedAt = timestamp;
  record(state, 'order_submitted', timestamp, { orderId: order.orderId, symbol, side, price, quantity, reason });
  timeline(state, `${side === 'BUY' ? '매수' : '매도'} 주문 접수 ${order.orderId} — ${won(price)} × ${quantity}주`, side === 'BUY' ? 'buy' : 'sell');
  return order;
}

function fill(state, order, timestamp, quantity = order.quantity) {
  const fillQty = Math.min(order.quantity - order.filledQuantity, Math.max(0, Math.floor(quantity)));
  if (fillQty <= 0) return;
  order.filledQuantity += fillQty;
  order.status = order.filledQuantity >= order.quantity ? 'FILLED' : 'PARTIAL';
  const event = order.side === 'BUY' ? 'buy_fill' : 'sell_fill';
  if (order.side === 'BUY') {
    state.filledBuyQty += fillQty;
    state.buyRemaining = Math.max(0, state.buyRemaining - fillQty);
    state.sellActive = true;
    if (state.buyRemaining === 0) state.buyComplete = true;
  } else {
    state.filledSellQty += fillQty;
    state.sellRemaining = Math.max(0, state.sellRemaining - fillQty);
    if (state.sellRemaining === 0) state.sellComplete = true;
  }
  record(state, event, timestamp, { orderId: order.orderId, symbol: order.symbol, filled: fillQty, price: order.price });
  timeline(state, `${order.side === 'BUY' ? '매수' : '매도'} ${fillQty}주 ${order.status === 'FILLED' ? '전량' : '부분'}체결 — ${order.orderId}`, order.side === 'BUY' ? 'buy' : 'sell');
  if (order.status === 'FILLED') state.activeOrder = null;
}

function cancelActive(state, timestamp, reason = 'unfilled_timeout') {
  const order = state.activeOrder;
  if (!order) return;
  if (order.status !== 'FILLED') order.status = 'CANCELED';
  record(state, 'order_canceled', timestamp, {
    orderId: order.orderId,
    symbol: order.symbol,
    side: order.side,
    remaining: order.quantity - order.filledQuantity,
    reason,
  });
  timeline(state, `미체결 잔량 ${order.quantity - order.filledQuantity}주 취소 — ${order.orderId}`, 'warn');
  state.activeOrder = null;
}

function handleTick(state, price, timestamp, { autoFill = false, partialFillQty = null } = {}) {
  timeline(state, `현재가 ${won(price)} 수신`, 'tick');
  const p = state.plan;
  if (state.activeOrder) {
    if (partialFillQty != null) fill(state, state.activeOrder, timestamp, partialFillQty);
    else if (autoFill) fill(state, state.activeOrder, timestamp);
    if (state.activeOrder && timestamp - state.activeSubmittedAt >= p.unfilledTimeoutSec) cancelActive(state, timestamp);
    return;
  }
  if (p.buy.enabled && !state.buyComplete && state.buyRemaining > 0 && price <= p.buy.price) {
    const order = submit(state, { symbol: p.symbol, side: 'BUY', price: p.buy.price, quantity: state.buyRemaining, timestamp, reason: 'buy_signal' });
    if (order && autoFill) fill(state, order, timestamp + 0.1);
    return;
  }
  if (p.sell.enabled && state.sellActive && !state.sellComplete && state.sellRemaining > 0 && price >= p.sell.price) {
    const order = submit(state, { symbol: p.symbol, side: 'SELL', price: p.sell.price, quantity: state.sellRemaining, timestamp, reason: 'sell_signal' });
    if (order && autoFill) fill(state, order, timestamp + 0.1);
  }
}

function normalizePlan(input = {}) {
  const buyQty = Math.max(0, Math.floor(num(input.buyQuantity ?? input.buy?.quantity, 0)));
  const sellQty = Math.max(0, Math.floor(num(input.sellQuantity ?? input.sell?.quantity, buyQty)));
  return {
    symbol: String(input.symbol || input.code || '').trim(),
    name: String(input.name || input.symbol || input.code || '').trim(),
    market: String(input.market || 'KR').trim() || 'KR',
    unfilledTimeoutSec: Math.max(1, Math.floor(num(input.unfilledTimeoutSec, DEFAULT_TIMEOUT_SEC))),
    buy: {
      enabled: input.buyEnabled !== false && input.buy?.enabled !== false && buyQty > 0,
      price: Math.max(0, Math.floor(num(input.buyPrice ?? input.buy?.price, 0))),
      quantity: buyQty,
    },
    sell: {
      enabled: input.sellEnabled !== false && input.sell?.enabled !== false && sellQty > 0,
      price: Math.max(0, Math.floor(num(input.sellPrice ?? input.sell?.price, 0))),
      quantity: sellQty,
    },
  };
}

function validatePlan(plan) {
  const errors = [];
  if (!plan.symbol) errors.push('종목을 선택하세요.');
  if (plan.buy.enabled && (!plan.buy.price || !plan.buy.quantity)) errors.push('매수 가격/수량을 입력하세요.');
  if (plan.sell.enabled && (!plan.sell.price || !plan.sell.quantity)) errors.push('매도 가격/수량을 입력하세요.');
  if (!plan.buy.enabled && !plan.sell.enabled) errors.push('매수 또는 매도 조건을 하나 이상 켜세요.');
  return errors;
}

export function runKiwoomMock(input = {}) {
  const plan = normalizePlan(input);
  const errors = validatePlan(plan);
  if (errors.length) return { ok: false, errors, plan, orders: [], journal: [], timeline: [], summary: null };

  const scenario = input.scenario || 'buy_then_sell';
  const state = {
    plan,
    scenario,
    maxOrderAmountKrw: Math.max(1, Math.floor(num(input.maxOrderAmountKrw, DEFAULT_MAX_ORDER_AMOUNT))),
    killSwitch: scenario === 'kill_switch' || input.killSwitch === true,
    seq: 0,
    orders: [],
    journal: [],
    timeline: [],
    activeOrder: null,
    activeSubmittedAt: 0,
    buyRemaining: plan.buy.quantity,
    sellRemaining: plan.sell.quantity,
    filledBuyQty: 0,
    filledSellQty: 0,
    buyComplete: !plan.buy.enabled,
    sellComplete: !plan.sell.enabled,
    sellActive: !plan.buy.enabled && plan.sell.enabled,
  };

  const buyPrice = plan.buy.price || Math.max(1, plan.sell.price - 1000);
  const sellPrice = plan.sell.price || Math.max(1, buyPrice + 1000);
  const aboveBuy = buyPrice + Math.max(1, Math.round(buyPrice * 0.01));

  if (scenario === 'buy_only') {
    handleTick(state, aboveBuy, 0);
    handleTick(state, buyPrice, 1, { autoFill: true });
  } else if (scenario === 'unfilled_cancel') {
    handleTick(state, buyPrice, 0, { autoFill: false });
    handleTick(state, buyPrice, plan.unfilledTimeoutSec + 1, { autoFill: false });
  } else if (scenario === 'partial_fill') {
    handleTick(state, buyPrice, 0, { autoFill: false });
    const partialQty = Math.max(1, Math.floor(plan.buy.quantity / 2));
    handleTick(state, buyPrice, plan.unfilledTimeoutSec + 1, { partialFillQty: partialQty });
    handleTick(state, buyPrice, plan.unfilledTimeoutSec + 2, { autoFill: false });
  } else if (scenario === 'kill_switch') {
    handleTick(state, buyPrice, 0, { autoFill: true });
  } else if (scenario === 'sell_only') {
    state.buyComplete = true;
    state.sellActive = true;
    handleTick(state, sellPrice - 1, 0);
    handleTick(state, sellPrice, 1, { autoFill: true });
  } else {
    handleTick(state, aboveBuy, 0);
    handleTick(state, buyPrice, 1, { autoFill: true });
    handleTick(state, sellPrice, 2, { autoFill: true });
  }

  return {
    ok: true,
    plan,
    scenario,
    orders: state.orders.map((o) => ({ ...o })),
    journal: state.journal,
    timeline: state.timeline,
    summary: {
      buyComplete: state.buyComplete,
      sellComplete: state.sellComplete,
      sellActive: state.sellActive,
      filledBuyQty: state.filledBuyQty,
      filledSellQty: state.filledSellQty,
      activeOrderId: state.activeOrder?.orderId || null,
      submittedCount: state.orders.length,
      canceledCount: state.orders.filter((o) => o.status === 'CANCELED').length,
      blockedCount: state.journal.filter((e) => e.event === 'order_blocked').length,
    },
  };
}

export const KIWOOM_MOCK_SCENARIOS = [
  { key: 'buy_then_sell', label: '매수 체결 후 매도까지', hint: '매수가 도달→매수 체결→매도가 도달→매도 체결' },
  { key: 'buy_only', label: '매수만 정상 체결', hint: '매수 조건만 확인' },
  { key: 'sell_only', label: '보유 가정 후 매도 체결', hint: '이미 보유 중이라고 가정하고 매도 조건만 확인' },
  { key: 'unfilled_cancel', label: '미체결 취소', hint: '주문 접수 후 체결 없이 타임아웃 취소' },
  { key: 'partial_fill', label: '부분체결 후 잔량 재감시', hint: '일부 체결→잔량 취소→남은 수량 재주문' },
  { key: 'kill_switch', label: 'Kill switch 차단', hint: '주문이 안전장치에서 차단되는지 확인' },
];
