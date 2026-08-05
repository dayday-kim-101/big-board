import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIndexRow, summarizeBreadth, parseInvestorTrendHtml, parseForeignerTopHtml, buildReport, applyMemo } from './_korea-market-core.js';

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
});

test('buildReport/applyMemo: 날짜 리포트와 한줄메모', () => {
  const report = buildReport({ date: '2026-08-05', indices: [parseIndexRow('KOSDAQ', { localTradedAt: '2026-08-05', closePrice: '799.59' })] });
  const next = applyMemo(report, '외국인 대형주 순매수 확인');
  assert.equal(next.date, '2026-08-05');
  assert.equal(next.memo, '외국인 대형주 순매수 확인');
});
