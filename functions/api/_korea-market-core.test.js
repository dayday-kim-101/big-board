import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIndexRow, summarizeBreadth, parseInvestorTrendHtml, parseForeignerTopHtml, buildReport, applyMemo, computeInvestorFlows, sanitizeReport } from './_korea-market-core.js';

test('parseIndexRow: 네이버 지수 응답 정규화', () => {
  const idx = parseIndexRow('KOSPI', {
    localTradedAt: '2026-08-05', closePrice: '6,598.26', compareToPreviousClosePrice: '239.31', fluctuationsRatio: '3.76', compareToPreviousPrice: { name: 'RISING' }, marketStatus: 'CLOSE',
  });
  assert.deepEqual({ code: idx.code, name: idx.name, date: idx.date, closePrice: idx.closePrice, change: idx.change, changePct: idx.changePct, direction: idx.direction, marketStatus: idx.marketStatus }, {
    code: 'KOSPI', name: 'KOSPI', date: '2026-08-05', closePrice: 6598.26, change: 239.31, changePct: 3.76, direction: 'RISING', marketStatus: 'CLOSE',
  });
});

test('summarizeBreadth: 상승/하락/보합 종목 수', () => {
  const s = summarizeBreadth([
    { compareToPreviousPrice: { name: 'RISING' }, fluctuationsRatio: '1.2' },
    { compareToPreviousPrice: { name: 'FALLING' }, fluctuationsRatio: '-0.4' },
    { compareToPreviousPrice: { name: 'UNCHANGED' }, fluctuationsRatio: '0.0' },
  ], 'KOSPI');
  assert.deepEqual(s, { market: 'KOSPI', upCount: 1, downCount: 1, flatCount: 1, stockCount: 3 });
});

test('parseInvestorTrendHtml: 개인/외국인/기관 순매수 억원→원', () => {
  const html = '<tr><td class="date2">26.08.05</td><td>-11,844</td><td>14,464</td><td>-2,838</td></tr>';
  const r = parseInvestorTrendHtml(html, '2026-08-05');
  assert.equal(r.personal, -1_184_400_000_000);
  assert.equal(r.foreign, 1_446_400_000_000);
  assert.equal(r.institution, -283_800_000_000);
});

test('parseForeignerTopHtml: 외국인 순매수 상위 파싱', () => {
  const html = '<tr><td><a href="/item/main.naver?code=005930">삼성전자</a></td><td>851</td><td>203,198</td><td>29,433,821</td></tr>';
  const [r] = parseForeignerTopHtml(html, 'KOSPI');
  assert.equal(r.code, '005930');
  assert.equal(r.name, '삼성전자');
  assert.equal(r.netBuyAmount, 203_198_000_000);
  assert.equal(r.netSellAmount, undefined);
});

test('parseForeignerTopHtml: 순매도 파싱은 netSellAmount만 채운다', () => {
  const html = '<tr><td><a href="/item/main.naver?code=005930">삼성전자</a></td><td>-1,737</td><td>-399,445</td><td>46,000,000</td></tr>';
  const [r] = parseForeignerTopHtml(html, 'KOSPI', '', 'sell');
  assert.equal(r.code, '005930');
  assert.equal(r.netBuyAmount, undefined);
  assert.equal(r.netSellAmount, -399_445_000_000);
});

test('parseForeignerTopHtml: 날짜 구간이 여러 개면 요청 날짜 섹션만 사용', () => {
  const html = `
    <div>26.08.06 외국인 순매수</div>
    <tr><td><a href="/item/main.naver?code=180640">한진칼</a></td><td>312</td><td>36,261</td><td>422,973</td></tr>
    <div>26.08.07 외국인 순매수</div>
    <tr><td><a href="/item/main.naver?code=402340">SK스퀘어</a></td><td>112</td><td>106,274</td><td>646,939</td></tr>
    <tr><td><a href="/item/main.naver?code=133690">TIGER 미국나스닥100</a></td><td>190</td><td>35,169</td><td>1,549,820</td></tr>
    <tr><td><a href="/item/main.naver?code=096770">SK이노베이션</a></td><td>270</td><td>30,619</td><td>1,271,355</td></tr>
  `;
  const rows = parseForeignerTopHtml(html, 'KOSPI', '2026-08-07');
  assert.deepEqual(rows.map((x) => x.name), ['SK스퀘어', 'SK이노베이션']);
  assert.equal(rows[0].netBuyAmount, 106_274_000_000);
});

test('buildReport/applyMemo: 날짜 리포트와 한줄메모', () => {
  const report = buildReport({
    date: '2026-08-05',
    indices: [parseIndexRow('KOSDAQ', { localTradedAt: '2026-08-05', closePrice: '799.59' })],
    foreignerTop: [
      { market: 'KOSPI', code: '005930', name: '삼성전자', netBuyAmount: 203_198_000_000 },
      { market: 'KOSPI', code: '028260', name: '삼성물산', netBuyAmount: 38_573_000_000 },
      { market: 'KOSPI', code: '035420', name: 'NAVER', netBuyAmount: 37_700_000_000 },
      { market: 'KOSDAQ', code: '028300', name: 'HLB', netBuyAmount: 15_726_000_000 },
      { market: 'KOSDAQ', code: '196170', name: '알테오젠', netBuyAmount: 14_284_000_000 },
      { market: 'KOSDAQ', code: '257720', name: '실리콘투', netBuyAmount: 13_350_000_000 },
    ],
    foreignerSellTop: [
      { market: 'KOSPI', code: '000660', name: 'SK하이닉스', netSellAmount: 100_000_000_000 },
      { market: 'KOSDAQ', code: '089970', name: '브이엠', netSellAmount: 20_000_000_000 },
    ],
  });
  const next = applyMemo(report, '외국인 대형주 순매수 확인');
  assert.equal(next.date, '2026-08-05');
  assert.equal(next.memo, '외국인 대형주 순매수 확인');
  assert.equal(next.foreignerTop.length, 6);
  assert.equal(next.foreignerTop.filter((x) => x.market === 'KOSDAQ').length, 3);
  assert.equal(next.foreignerSellTop.length, 2);
  assert.equal(next.foreignerSellTop[0].netSellAmount, 100_000_000_000);
});

const T = 1_000_000_000_000;
function flowReport(date, kospi, kosdaq) {
  return {
    date,
    markets: [
      { key: 'KOSPI', label: '코스피', investor: kospi ? { market: 'KOSPI', date, ...kospi } : null },
      { key: 'KOSDAQ', label: '코스닥', investor: kosdaq ? { market: 'KOSDAQ', date, ...kosdaq } : null },
    ],
  };
}

test('computeInvestorFlows: 5/10/20일 누적과 평균', () => {
  const reports = Array.from({ length: 20 }, (_, i) => flowReport(
    `2026-08-${String(20 - i).padStart(2, '0')}`,
    { personal: T, foreign: -T, institution: 0 },
    { personal: 2 * T, foreign: 0, institution: 0 },
  ));
  const flows = computeInvestorFlows(reports);
  const kospi = flows.markets.find((m) => m.key === 'KOSPI');
  assert.deepEqual(kospi.flows.personal.map((f) => [f.window, f.days, f.total, f.average, f.complete]), [
    [5, 5, 5 * T, T, true], [10, 10, 10 * T, T, true], [20, 20, 20 * T, T, true],
  ]);
  assert.equal(kospi.flows.foreign[0].total, -5 * T);
  assert.equal(flows.markets.find((m) => m.key === 'KOSDAQ').flows.personal[2].total, 40 * T);
  assert.equal(flows.asOf, '2026-08-20');
  assert.equal(flows.sampleDays, 20);
});

test('computeInvestorFlows: 데이터 부족 시 가능한 일수만 집계', () => {
  const reports = [
    flowReport('2026-08-20', { personal: 3 * T, foreign: null, institution: null }),
    flowReport('2026-08-19', { personal: T, foreign: null, institution: null }),
    null,
  ];
  const kospi = computeInvestorFlows(reports).markets.find((m) => m.key === 'KOSPI');
  assert.deepEqual(kospi.flows.personal[0], { window: 5, days: 2, total: 4 * T, average: 2 * T, complete: false });
  assert.deepEqual(kospi.flows.foreign[0], { window: 5, days: 0, total: null, average: null, complete: false });
  assert.deepEqual(kospi.flows.personal[2], { window: 20, days: 2, total: 4 * T, average: 2 * T, complete: false });
});

test('sanitizeReport/applyMemo: investorFlows 보존', () => {
  const investorFlows = computeInvestorFlows([flowReport('2026-08-20', { personal: T, foreign: -T, institution: 0 })]);
  const out = applyMemo(sanitizeReport({ date: '2026-08-20', investorFlows }), '메모');
  assert.equal(out.investorFlows.markets.length, 2);
  assert.equal(out.investorFlows.markets[0].flows.personal[0].total, T);
  assert.equal(out.investorFlows.markets[0].flows.foreign[0].average, -T);
  assert.equal(sanitizeReport({ date: '2026-08-20' }).investorFlows, null);
});
