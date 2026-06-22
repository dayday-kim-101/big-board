import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKiwoomClipboard, pickPrevClose, computeStats } from './trades-core.js';

// ---------- parseKiwoomClipboard ----------

// 14컬럼 행 헬퍼: 탭 구분자 14개 정확히 포함
function row14(cols) {
  // cols 배열 길이가 14가 되도록 빈 문자열로 패딩
  const padded = [...cols];
  while (padded.length < 14) padded.push('');
  return padded.join('\t');
}

test('parseKiwoomClipboard: 헤더 2줄 스킵 후 정상 행 파싱', () => {
  const text = [
    '헤더1\t무시',
    '헤더2\t무시',
    row14(["'001820", '삼화콘덴서', '"183,700"', '3', '"551,100"', '"165,200"', '3', '"495,600"', '"1,140"', '"-56,640"', '-10.28%', '', '', '']),
  ].join('\n');
  const records = parseKiwoomClipboard(text);
  assert.equal(records.length, 1);
  const r = records[0];
  assert.equal(r.code, '001820');
  assert.equal(r.name, '삼화콘덴서');
  assert.equal(r.market, 'KR');
  assert.equal(r.buyAvg, 183700);
  assert.equal(r.qty, 3);
  assert.equal(r.buyAmount, 551100);
  assert.equal(r.sellAvg, 165200);
  assert.equal(r.sellAmount, 495600);
  assert.equal(r.fee, 1140);
  assert.equal(r.pnl, -56640);
  assert.equal(r.returnPct, -10.28);
});

test('parseKiwoomClipboard: 선행 작은따옴표 코드 스트립', () => {
  const text = [
    '헤더1',
    '헤더2',
    row14(["'005930", '삼성전자', '83000', '10', '830000', '85000', '10', '850000', '1000', '19000', '2.29%', '', '', '']),
  ].join('\n');
  const records = parseKiwoomClipboard(text);
  assert.equal(records[0].code, '005930');
  assert.equal(records[0].returnPct, 2.29);
});

test('parseKiwoomClipboard: 따옴표+쉼표 숫자 변환', () => {
  const text = [
    '헤더1',
    '헤더2',
    row14(["'001234", '테스트종목', '"1,234,567"', '5', '"6,172,835"', '"1,300,000"', '5', '"6,500,000"', '"5,000"', '"322,165"', '5.22%', '', '', '']),
  ].join('\n');
  const records = parseKiwoomClipboard(text);
  assert.equal(records.length, 1);
  assert.equal(records[0].buyAvg, 1234567);
  assert.equal(records[0].sellAmount, 6500000);
});

test('parseKiwoomClipboard: 컬럼 14개 미만 행 스킵', () => {
  const text = [
    '헤더1',
    '헤더2',
    // 3컬럼만 — 스킵되어야 함
    "'001820\t짧은행\t100",
  ].join('\n');
  const records = parseKiwoomClipboard(text);
  assert.equal(records.length, 0);
});

test('parseKiwoomClipboard: 빈 줄 스킵', () => {
  const text = [
    '헤더1',
    '헤더2',
    '',
    row14(["'001820", '삼화콘덴서', '183700', '3', '551100', '165200', '3', '495600', '1140', '-56640', '-10.28%', '', '', '']),
    '',
  ].join('\n');
  const records = parseKiwoomClipboard(text);
  assert.equal(records.length, 1);
});

test('parseKiwoomClipboard: returnPct 음수/양수 파싱', () => {
  const text = [
    '헤더1',
    '헤더2',
    row14(["'000001", 'A종목', '100', '1', '100', '110', '1', '110', '0', '10', '10.00%', '', '', '']),
    row14(["'000002", 'B종목', '100', '1', '100', '90', '1', '90', '0', '-10', '-10.00%', '', '', '']),
  ].join('\n');
  const records = parseKiwoomClipboard(text);
  assert.equal(records[0].returnPct, 10.00);
  assert.equal(records[1].returnPct, -10.00);
});

test('parseKiwoomClipboard: 분할매도 — qty는 매도수량(청산분)', () => {
  // HPSP: 9주 매수 중 2주만 매도 → qty===2 (매수수량 9 아님)
  const text = [
    '종목코드\t종목명\t금일매수\t\t\t금일매도\t\t\t수수료+제세금\t손익금액\t수익률\t대출일\t신용구분\t이전매입가',
    '\t\t평균가\t수량\t매입금액\t평균가\t수량\t매도금액\t\t\t\t\t\t',
    `'403870\tHPSP\t"59,000"\t"9"\t"531,000"\t"60,800"\t"2"\t"121,600"\t"323"\t"3,277"\t"2.78%"\t\t\t""`,
  ].join('\n');
  const records = parseKiwoomClipboard(text);
  assert.equal(records.length, 1);
  assert.equal(records[0].code, '403870');
  assert.equal(records[0].qty, 2);
  assert.equal(records[0].sellAvg, 60800);
});

test('parseKiwoomClipboard: 빈 text 반환 빈 배열', () => {
  assert.deepEqual(parseKiwoomClipboard(''), []);
  assert.deepEqual(parseKiwoomClipboard(null), []);
});

// ---------- pickPrevClose ----------

test('pickPrevClose: date 이전 마지막 거래일 close 반환', () => {
  const candles = [
    { time: '2026-06-17', close: 100 },
    { time: '2026-06-18', close: 105 },
    { time: '2026-06-19', close: 110 }, // 당일 — 제외
  ];
  const result = pickPrevClose(candles, '2026-06-19');
  assert.equal(result, 105); // 6/18이 직전
});

test('pickPrevClose: 휴장 갭 (중간 날짜 없음)', () => {
  const candles = [
    { time: '2026-06-13', close: 200 },
    // 6/14~6/18 없음 (주말+공휴일)
    { time: '2026-06-19', close: 210 },
  ];
  const result = pickPrevClose(candles, '2026-06-19');
  assert.equal(result, 200); // 6/13이 직전 거래일
});

test('pickPrevClose: date 이전 데이터 없으면 null', () => {
  const candles = [
    { time: '2026-06-20', close: 300 },
    { time: '2026-06-21', close: 310 },
  ];
  const result = pickPrevClose(candles, '2026-06-19');
  assert.equal(result, null);
});

test('pickPrevClose: 빈 candles → null', () => {
  assert.equal(pickPrevClose([], '2026-06-19'), null);
  assert.equal(pickPrevClose(null, '2026-06-19'), null);
});

// ---------- computeStats ----------

function makeRecord(overrides) {
  return {
    code: '000001', name: 'A', market: 'KR',
    buyAvg: 100, sellAvg: 110, qty: 1,
    buyAmount: 100, sellAmount: 110,
    fee: 0, pnl: 10, returnPct: 10,
    holdDays: 0, tags: [],
    ...overrides,
  };
}

test('computeStats: 빈 배열 → 기본값', () => {
  const s = computeStats([]);
  assert.equal(s.tradeCount, 0);
  assert.equal(s.winRate, 0);
  assert.equal(s.cumPnl, 0);
  assert.equal(s.avgReturn, 0);
});

test('computeStats: winRate 계산 — 본전(0%) 비승 처리', () => {
  const records = [
    makeRecord({ returnPct: 5, pnl: 50 }),   // 승
    makeRecord({ returnPct: 0, pnl: 0 }),    // 본전 → 비승
    makeRecord({ returnPct: -3, pnl: -30 }), // 패
  ];
  const s = computeStats(records);
  assert.equal(s.tradeCount, 3);
  // 1승 / 3 = 0.333...
  assert.ok(Math.abs(s.winRate - 1 / 3) < 1e-10);
});

test('computeStats: winRate 분모는 청산(returnPct 존재) 건만 (AC-11)', () => {
  const records = [
    makeRecord({ returnPct: 5, pnl: 50 }),       // 청산·승
    makeRecord({ returnPct: -3, pnl: -30 }),     // 청산·패
    makeRecord({ returnPct: null, pnl: 0 }),     // 미청산(매도 안 함) → 분모 제외
  ];
  const s = computeStats(records);
  // 1승 / 2청산 = 0.5 (records.length=3 아님)
  assert.ok(Math.abs(s.winRate - 0.5) < 1e-10);
});

test('computeStats: cumPnl = sum(pnl)', () => {
  const records = [
    makeRecord({ pnl: 100 }),
    makeRecord({ pnl: -50 }),
    makeRecord({ pnl: 200 }),
  ];
  const s = computeStats(records);
  assert.equal(s.cumPnl, 250);
});

test('computeStats: avgReturn = mean(returnPct)', () => {
  const records = [
    makeRecord({ returnPct: 10 }),
    makeRecord({ returnPct: -5 }),
    makeRecord({ returnPct: 15 }),
  ];
  const s = computeStats(records);
  assert.ok(Math.abs(s.avgReturn - (10 - 5 + 15) / 3) < 1e-10);
});

test('computeStats: byTheme 태그별 누적', () => {
  const records = [
    makeRecord({ tags: ['MLCC'], pnl: 100, returnPct: 10 }),
    makeRecord({ tags: ['MLCC', 'EV'], pnl: -50, returnPct: -5 }),
    makeRecord({ tags: ['EV'], pnl: 200, returnPct: 20 }),
  ];
  const s = computeStats(records);
  assert.equal(s.byTheme['MLCC'].count, 2);
  assert.equal(s.byTheme['MLCC'].pnl, 50);
  assert.ok(Math.abs(s.byTheme['MLCC'].winRate - 0.5) < 1e-10);
  assert.equal(s.byTheme['EV'].count, 2);
  assert.equal(s.byTheme['EV'].pnl, 150);
  assert.ok(Math.abs(s.byTheme['EV'].winRate - 0.5) < 1e-10);
});

test('computeStats: byHoldPeriod 버킷(0/1/2-4/5+)', () => {
  const records = [
    makeRecord({ holdDays: 0, pnl: 10 }),
    makeRecord({ holdDays: 1, pnl: 20 }),
    makeRecord({ holdDays: 2, pnl: 30 }),
    makeRecord({ holdDays: 4, pnl: 40 }),
    makeRecord({ holdDays: 5, pnl: 50 }),
    makeRecord({ holdDays: 10, pnl: 60 }),
  ];
  const s = computeStats(records);
  assert.equal(s.byHoldPeriod['0'].count, 1);
  assert.equal(s.byHoldPeriod['1'].count, 1);
  assert.equal(s.byHoldPeriod['2-4'].count, 2);
  assert.equal(s.byHoldPeriod['5+'].count, 2);
  assert.equal(s.byHoldPeriod['5+'].pnl, 110);
});

test('computeStats: holdDays 없으면 0 버킷', () => {
  const records = [
    makeRecord({ holdDays: undefined }),
    makeRecord({ holdDays: null }),
  ];
  const s = computeStats(records);
  assert.equal(s.byHoldPeriod['0'].count, 2);
});

test('computeStats: byStock 코드별 집계', () => {
  const records = [
    makeRecord({ code: 'A', name: '에이', pnl: 100, returnPct: 10 }),
    makeRecord({ code: 'A', name: '에이', pnl: -50, returnPct: -5 }),
    makeRecord({ code: 'B', name: '비', pnl: 200, returnPct: 20 }),
  ];
  const s = computeStats(records);
  assert.equal(s.byStock['A'].count, 2);
  assert.equal(s.byStock['A'].pnl, 50);
  assert.ok(Math.abs(s.byStock['A'].winRate - 0.5) < 1e-10);
  assert.equal(s.byStock['B'].count, 1);
  assert.equal(s.byStock['B'].winRate, 1);
});
