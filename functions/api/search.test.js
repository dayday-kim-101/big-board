import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNaverSearch, parseYahooSearch, mergeResults } from './_search-core.js';

// 실제 응답에서 추출한 픽스처
const naver = {
  query: '삼성',
  items: [
    { code: '005930', name: '삼성전자', typeCode: 'KOSPI', typeName: '코스피', nationCode: 'KOR', category: 'stock' },
    { code: '247540', name: '에코프로비엠', typeCode: 'KOSDAQ', typeName: '코스닥', nationCode: 'KOR', category: 'stock' },
    { code: 'AAPL', name: 'Apple', nationCode: 'USA', category: 'stock' }, // 해외 → 제외
    { code: 'KS200', name: '코스피200', category: 'index' }, // 지수 → 제외(6자리 아님)
  ],
};

const yahoo = {
  quotes: [
    { symbol: 'AAPL', shortname: 'Apple Inc.', quoteType: 'EQUITY', exchange: 'NMS' },
    { symbol: 'SPY', shortname: 'SPDR S&P 500 ETF', quoteType: 'ETF', exchange: 'PCX' },
    { symbol: '005930.KS', shortname: 'SamsungElec', quoteType: 'EQUITY', exchange: 'KSC' }, // 접미사/비US → 제외
    { symbol: '2788.T', shortname: 'APPLE INTL', quoteType: 'EQUITY', exchange: 'JPX' }, // 해외 → 제외
    { symbol: 'AAPL.TO', shortname: 'APPLE CDR', quoteType: 'EQUITY', exchange: 'TOR' }, // 캐나다 → 제외
    { symbol: '005930-USD', shortname: 'Samsung deriv', quoteType: 'CRYPTOCURRENCY', exchange: 'CCC' }, // 크립토 → 제외
  ],
};

test('parseNaverSearch: KR 6자리 종목만, 해외/지수 제외', () => {
  const out = parseNaverSearch(naver);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { market: 'KR', code: '005930', name: '삼성전자', sub: '코스피' });
  assert.equal(out[1].code, '247540');
  assert.equal(out[1].sub, '코스닥');
});

test('parseYahooSearch: US 정규 거래소 EQUITY/ETF만', () => {
  const out = parseYahooSearch(yahoo);
  const codes = out.map((r) => r.code);
  assert.deepEqual(codes, ['AAPL', 'SPY'], '비US/접미사/크립토 전부 제외');
  assert.equal(out[0].name, 'Apple Inc.');
  assert.equal(out[0].market, 'US');
});

test('parseNaverSearch: 빈/이상 입력 안전', () => {
  assert.deepEqual(parseNaverSearch(null), []);
  assert.deepEqual(parseNaverSearch({ items: 'x' }), []);
});

test('mergeResults: KR 우선 + 중복 제거 + limit', () => {
  const kr = parseNaverSearch(naver);
  const us = parseYahooSearch(yahoo);
  const merged = mergeResults([kr, us], 8);
  assert.equal(merged[0].market, 'KR', 'KR 먼저');
  assert.equal(merged.length, 4); // 005930, 247540, AAPL, SPY
  // 중복 제거
  const dup = mergeResults([[{ market: 'US', code: 'AAPL', name: 'a' }, { market: 'US', code: 'AAPL', name: 'a' }]], 8);
  assert.equal(dup.length, 1);
  // limit
  assert.equal(mergeResults([kr, us], 2).length, 2);
});
