// _jaelyo-core 순수 함수 테스트 — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAllStocks,
  rankByTradingValue,
  computeTvToMcapPct,
  buildRankMap,
  attachPrevRank,
  mergeManual,
  normalizeBoard,
  sanitizeManual,
  emptyManual,
  toKrxDate,
  MANUAL_FIELDS,
} from './_jaelyo-core.js';

// --- parseAllStocks: KRX 전종목 시세(MDCSTAT01501) → 정규화 (거래대금·시총 원 단위 그대로) ---
test('parseAllStocks: 필드 매핑(원 단위, 콤마 제거)', () => {
  const json = {
    OutBlock_1: [
      { ISU_SRT_CD: '028050', ISU_ABBRV: '삼성E&A', TDD_CLSPRC: '64,900', FLUC_RT: '23.60', ACC_TRDVAL: '152,285,000,000', MKTCAP: '1,270,000,000,000' },
      { ISU_SRT_CD: '005930', ISU_ABBRV: '삼성전자', TDD_CLSPRC: '81,000', FLUC_RT: '-1.20', ACC_TRDVAL: '1,000,000,000,000', MKTCAP: '500,000,000,000,000' },
    ],
  };
  const rows = parseAllStocks(json);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    code: '028050', name: '삼성E&A', price: 64900, changePct: 23.6, tradingValue: 152_285_000_000, marketCap: 1_270_000_000_000,
  });
  assert.equal(rows[1].changePct, -1.2);
});

test('parseAllStocks: code 없는 행 제외', () => {
  const rows = parseAllStocks({ OutBlock_1: [{ ISU_SRT_CD: '', ISU_ABBRV: 'x', ACC_TRDVAL: '1' }, { ISU_SRT_CD: '000660', ISU_ABBRV: 'SK하이닉스', ACC_TRDVAL: '5', MKTCAP: '10' }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, '000660');
});

test('parseAllStocks: 형식 오류 → throw / 빈 목록 → []', () => {
  assert.throws(() => parseAllStocks({}), /형식/);
  assert.throws(() => parseAllStocks(null), /형식/);
  assert.deepEqual(parseAllStocks({ OutBlock_1: [] }), []);
});

// --- rankByTradingValue: 거래대금 desc 상위 N + rank·비율 ---
test('rankByTradingValue: 거래대금 내림차순 top-N, rank 1..N, 비율 계산', () => {
  const all = [
    { code: 'a', name: 'A', price: 1, changePct: 1, tradingValue: 100, marketCap: 1000 },
    { code: 'b', name: 'B', price: 2, changePct: 2, tradingValue: 500, marketCap: 2500 },
    { code: 'c', name: 'C', price: 3, changePct: 3, tradingValue: 300, marketCap: null },
  ];
  const ranked = rankByTradingValue(all, 2);
  assert.equal(ranked.length, 2);
  assert.deepEqual(ranked.map((r) => r.code), ['b', 'c']); // 거래대금 500 > 300
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 2);
  assert.equal(ranked[0].tvToMcapPct, 20); // 500/2500*100
  assert.equal(ranked[1].tvToMcapPct, null); // 시총 null
});

test('rankByTradingValue: 거래대금 null 행 제외', () => {
  const ranked = rankByTradingValue([{ code: 'a', tradingValue: null }, { code: 'b', tradingValue: 10, marketCap: 100 }]);
  assert.deepEqual(ranked.map((r) => r.code), ['b']);
});

// --- computeTvToMcapPct ---
test('computeTvToMcapPct: 4천억/2조 = 20', () => {
  assert.equal(computeTvToMcapPct(400_000_000_000, 2_000_000_000_000), 20);
});

test('computeTvToMcapPct: 분모 0/누락 → null', () => {
  assert.equal(computeTvToMcapPct(100, 0), null);
  assert.equal(computeTvToMcapPct(100, null), null);
  assert.equal(computeTvToMcapPct(null, 100), null);
});

// --- toKrxDate ---
test('toKrxDate: YYYY-MM-DD → YYYYMMDD', () => {
  assert.equal(toKrxDate('2026-05-07'), '20260507');
  assert.equal(toKrxDate(''), '');
});

// --- buildRankMap / attachPrevRank ---
test('buildRankMap + attachPrevRank: 전일순위 부여, 없으면 null', () => {
  const prev = [{ code: '028050', rank: 1063 }, { code: '005930', rank: 1 }];
  const map = buildRankMap(prev);
  assert.equal(map['028050'], 1063);
  const rows = attachPrevRank([{ code: '028050', rank: 5 }, { code: '999999', rank: 7 }], map);
  assert.equal(rows[0].prevRank, 1063);
  assert.equal(rows[1].prevRank, null);
});

// --- sanitizeManual / mergeManual ---
test('sanitizeManual: 7개 키만 통과, 문자열 trim', () => {
  const m = sanitizeManual({ theme: '  건설 ', bogus: 'x', material: '실적' });
  assert.deepEqual(Object.keys(m).sort(), [...MANUAL_FIELDS].sort());
  assert.equal(m.theme, '건설');
  assert.equal(m.material, '실적');
  assert.equal(m.newOrExisting, '');
  assert.equal(m.bogus, undefined);
});

test('mergeManual: 기존 manual을 code 기준 보존, 신규는 빈값', () => {
  const prev = [{ code: '028050', manual: { theme: '건설', material: '수주' } }];
  const merged = mergeManual([{ code: '028050', rank: 5 }, { code: '111111', rank: 6 }], prev);
  assert.equal(merged[0].manual.theme, '건설');
  assert.equal(merged[0].manual.material, '수주');
  assert.deepEqual(merged[1].manual, emptyManual());
});

test('mergeManual: prevRows에 없는 code는 자신의 manual을 보존(재실행 idempotent)', () => {
  const merged = mergeManual([{ code: '028050', rank: 5, manual: { theme: '바이오' } }], []);
  assert.equal(merged[0].manual.theme, '바이오');
  assert.equal(merged[0].manual.material, '');
});

// --- normalizeBoard ---
test('normalizeBoard: 알 수 없는 필드 제거 + manual 항상 존재 + source 기본 krx', () => {
  const board = normalizeBoard({
    date: '2026-05-07',
    collectedAt: '2026-05-07T06:40:00Z',
    rows: [{ rank: 5, code: '028050', name: '삼성E&A', price: 64900, changePct: 23.6, marketCap: 1.27e12, tradingValue: 1.5e11, tvToMcapPct: 12, junk: 'x' }],
  });
  assert.equal(board.date, '2026-05-07');
  assert.equal(board.source, 'krx');
  const r = board.rows[0];
  assert.equal(r.junk, undefined);
  assert.deepEqual(Object.keys(r.manual).sort(), [...MANUAL_FIELDS].sort());
});
