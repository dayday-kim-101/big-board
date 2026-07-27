// _jaelyo-core 순수 함수 테스트 — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNaverStocks,
  naverTradedDate,
  rankByTradingValue,
  computeTvToMcapPct,
  buildRankMap,
  attachPrevRank,
  mergeManual,
  mergeRowsWithGlobalManual,
  updateGlobalManual,
  buildGlobalManualByCodeFromBoards,
  normalizeBoard,
  sanitizeManual,
  emptyManual,
  MANUAL_FIELDS,
  NOTES_MAX_LEN,
  inferRowTheme,
  dailyThemeEligibleRows,
  buildDailyTheme,
  applyDailyThemePatch,
} from './_jaelyo-core.js';

// --- parseNaverStocks: 네이버 모바일 시세 → 정규화 (거래대금·시총 백만원 → 원) ---
test('parseNaverStocks: 필드 매핑 + 백만원→원 환산', () => {
  const json = {
    stocks: [
      // 거래대금 accumulatedTradingValue=백만원, 시총 marketValue=억원 (네이버 단위)
      { itemCode: '028050', stockName: '삼성E&A', stockEndType: 'stock', closePrice: '64,900', fluctuationsRatio: '23.60', accumulatedTradingValue: '152,285', marketValue: '12,700', localTradedAt: '2026-05-07T15:38:23+09:00' },
      { itemCode: '005930', stockName: '삼성전자', stockEndType: 'stock', closePrice: '81,000', fluctuationsRatio: '-1.20', accumulatedTradingValue: '8,937,536', marketValue: '17,480,373' },
    ],
  };
  const rows = parseNaverStocks(json);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    code: '028050', name: '삼성E&A', price: 64900, changePct: 23.6, tradingValue: 152_285 * 1_000_000, marketCap: 12_700 * 100_000_000, // 1.27조
  });
  assert.equal(rows[1].changePct, -1.2);
  assert.equal(rows[1].tradingValue, 8_937_536 * 1_000_000); // 8.9조원
  assert.equal(rows[1].marketCap, 17_480_373 * 100_000_000); // 1,748조원
});

test('parseNaverStocks: code 없는 행 제외', () => {
  const rows = parseNaverStocks({ stocks: [{ itemCode: '', stockName: 'x', stockEndType: 'stock' }, { itemCode: '000660', stockName: 'SK하이닉스', stockEndType: 'stock', accumulatedTradingValue: '5', marketValue: '10' }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, '000660');
});

test('parseNaverStocks: ETF/ETN 제외(stockEndType=stock만)', () => {
  const rows = parseNaverStocks({ stocks: [
    { itemCode: '005930', stockName: '삼성전자', stockEndType: 'stock', accumulatedTradingValue: '10', marketValue: '100' },
    { itemCode: '122630', stockName: 'KODEX 레버리지', stockEndType: 'etf', accumulatedTradingValue: '999', marketValue: '5' },
    { itemCode: '530031', stockName: 'ETN상품', stockEndType: 'etn', accumulatedTradingValue: '999', marketValue: '5' },
  ] });
  assert.deepEqual(rows.map((r) => r.code), ['005930']);
});

test('parseNaverStocks: 형식 오류 → throw / 빈 목록 → []', () => {
  assert.throws(() => parseNaverStocks({}), /형식/);
  assert.throws(() => parseNaverStocks(null), /형식/);
  assert.deepEqual(parseNaverStocks({ stocks: [] }), []);
});

test('naverTradedDate: 첫 종목 localTradedAt에서 YYYY-MM-DD', () => {
  assert.equal(naverTradedDate({ stocks: [{ localTradedAt: '2026-05-07T15:38:23+09:00' }] }), '2026-05-07');
  assert.equal(naverTradedDate({ stocks: [{}] }), null);
  assert.equal(naverTradedDate({ stocks: [] }), null);
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
test('sanitizeManual: 화이트리스트 키만 통과, 문자열 trim', () => {
  const m = sanitizeManual({ theme: '  건설 ', bogus: 'x', material: '실적' });
  assert.deepEqual(Object.keys(m).sort(), [...MANUAL_FIELDS].sort());
  assert.equal(m.theme, '건설');
  assert.equal(m.material, '실적');
  assert.equal(m.newOrExisting, '');
  assert.equal(m.notes, '');
  assert.equal(m.bogus, undefined);
});

test('sanitizeManual: 자유 메모 notes 허용 + 여러 줄 보존 + 앞뒤 공백 trim', () => {
  const m = sanitizeManual({ notes: '  (로봇) 액추에이터 제조\n세계: 확대\n국내: 순매수  ' });
  assert.equal(m.notes, '(로봇) 액추에이터 제조\n세계: 확대\n국내: 순매수'); // 내부 개행 유지, 양끝만 trim
});

test('sanitizeManual: notes 길이 제한(NOTES_MAX_LEN)으로 절단', () => {
  const long = 'x'.repeat(NOTES_MAX_LEN + 500);
  const m = sanitizeManual({ notes: long });
  assert.equal(m.notes.length, NOTES_MAX_LEN);
});

test('sanitizeManual: 레거시 memo → notes 승격(notes 비었을 때만)', () => {
  assert.equal(sanitizeManual({ memo: '  옛 메모  ' }).notes, '옛 메모'); // notes 없으면 memo 채움
  // notes가 이미 있으면 memo로 덮어쓰지 않음
  assert.equal(sanitizeManual({ notes: '새 메모', memo: '옛 메모' }).notes, '새 메모');
  // memo 키는 화이트리스트가 아니므로 own 속성으로 남지 않음
  assert.equal(Object.prototype.hasOwnProperty.call(sanitizeManual({ memo: 'x' }), 'memo'), false);
});

test('sanitizeManual: notes에도 프로토타입 오염 방어 유지', () => {
  const m = sanitizeManual(JSON.parse('{"__proto__":{"polluted":true},"notes":"메모"}'));
  assert.equal(m.notes, '메모');
  assert.equal(Object.prototype.hasOwnProperty.call(m, 'polluted'), false);
  assert.equal(({}).polluted, undefined, '전역 Object 오염 없음');
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

// --- mergeRowsWithGlobalManual: 행 값 우선 + 빈 필드 글로벌 폴백 ---
test('mergeRowsWithGlobalManual: 행 non-empty 우선, 빈 필드만 글로벌로 폴백', () => {
  const global = {
    '005930': sanitizeManual({ theme: '반도체', material: 'HBM', notes: '글로벌 메모' }),
  };
  const rows = [
    { code: '005930', manual: sanitizeManual({ theme: '메모리', notes: '' }) },
  ];
  const merged = mergeRowsWithGlobalManual(rows, global);
  assert.equal(merged[0].manual.theme, '메모리'); // 행 값 우선(덮지 않음)
  assert.equal(merged[0].manual.material, 'HBM'); // 빈 필드 → 글로벌 폴백
  assert.equal(merged[0].manual.notes, '글로벌 메모'); // notes도 빈값이면 폴백
});

test('mergeRowsWithGlobalManual: 글로벌에 없는 code는 행 manual 그대로(8키 정제)', () => {
  const merged = mergeRowsWithGlobalManual([{ code: '111111', manual: { theme: '바이오' } }], {});
  assert.equal(merged[0].manual.theme, '바이오');
  assert.equal(merged[0].manual.material, '');
  assert.deepEqual(Object.keys(merged[0].manual).sort(), [...MANUAL_FIELDS].sort());
});

test('mergeRowsWithGlobalManual: 프로토타입 오염 code는 폴백 안 함', () => {
  const merged = mergeRowsWithGlobalManual([{ code: '__proto__', manual: {} }], {});
  assert.deepEqual(merged[0].manual, emptyManual());
  assert.equal(({}).theme, undefined);
});

// --- updateGlobalManual: patch만 code-level map 갱신 ---
test('updateGlobalManual: patch 필드만 갱신, 나머지 기존 글로벌 유지', () => {
  const g0 = { '005930': sanitizeManual({ theme: '반도체', material: 'HBM', notes: '메모' }) };
  const g1 = updateGlobalManual(g0, '005930', { material: 'DDR5' });
  assert.equal(g1['005930'].material, 'DDR5'); // patch 반영
  assert.equal(g1['005930'].theme, '반도체'); // 미포함 필드 보존
  assert.equal(g1['005930'].notes, '메모'); // notes 보존
  assert.equal(g0['005930'].material, 'HBM'); // 입력 불변
});

test('updateGlobalManual: 없던 code는 새로 추가', () => {
  const g1 = updateGlobalManual({}, '000660', { theme: '반도체' });
  assert.equal(g1['000660'].theme, '반도체');
  assert.deepEqual(Object.keys(g1['000660']).sort(), [...MANUAL_FIELDS].sort());
});

test('updateGlobalManual: 빈 문자열로도 필드를 비울 수 있음', () => {
  const g0 = { '005930': sanitizeManual({ theme: '반도체' }) };
  const g1 = updateGlobalManual(g0, '005930', { theme: '' });
  assert.equal(g1['005930'].theme, ''); // 명시적 빈값 갱신
});

test('updateGlobalManual: 프로토타입 오염 방어(code·필드)', () => {
  const g1 = updateGlobalManual({}, '__proto__', { theme: 'x' });
  assert.equal(Object.prototype.hasOwnProperty.call(g1, '__proto__'), false);
  const g2 = updateGlobalManual({}, '005930', JSON.parse('{"__proto__":{"polluted":true},"theme":"건설"}'));
  assert.equal(g2['005930'].theme, '건설');
  assert.equal(({}).polluted, undefined);
});

// --- buildGlobalManualByCodeFromBoards: dated non-empty 우선, seed 폴백 ---
test('buildGlobalManualByCodeFromBoards: 최신 dated non-empty가 seed보다 우선', () => {
  const boards = [
    { date: '2026-07-01', rows: [{ code: '005930', manual: sanitizeManual({ theme: '반도체' }) }] },
    { date: '2026-07-06', rows: [{ code: '005930', manual: sanitizeManual({ theme: '메모리(HBM)' }) }] },
  ];
  const seeds = { manualSeed: { '005930': { theme: 'SEED테마', material: 'SEED재료' } }, notesSeed: { '005930': 'SEED메모' } };
  const g = buildGlobalManualByCodeFromBoards(boards, seeds);
  assert.equal(g['005930'].theme, '메모리(HBM)'); // 최신 dated non-empty 우선
  assert.equal(g['005930'].material, 'SEED재료'); // dated에 없던 필드 → seed 폴백
  assert.equal(g['005930'].notes, 'SEED메모'); // notes seed 폴백
});

test('buildGlobalManualByCodeFromBoards: 빈 dated 필드는 이전 non-empty를 덮지 않음', () => {
  const boards = [
    { date: '2026-07-01', rows: [{ code: '005930', manual: sanitizeManual({ theme: '반도체', notes: '옛 메모' }) }] },
    { date: '2026-07-07', rows: [{ code: '005930', manual: emptyManual() }] }, // 전부 빈 최신 파일
  ];
  const g = buildGlobalManualByCodeFromBoards(boards);
  assert.equal(g['005930'].theme, '반도체'); // 빈 최신 파일이 덮지 않음
  assert.equal(g['005930'].notes, '옛 메모');
});

test('buildGlobalManualByCodeFromBoards: notes-seed만 있는 code도 포함', () => {
  const g = buildGlobalManualByCodeFromBoards([], { notesSeed: { '000150': '(테마) 지주' } });
  assert.equal(g['000150'].notes, '(테마) 지주');
});

// --- normalizeBoard ---
test('normalizeBoard: 알 수 없는 필드 제거 + manual 항상 존재 + source 기본 naver', () => {
  const board = normalizeBoard({
    date: '2026-05-07',
    collectedAt: '2026-05-07T06:40:00Z',
    rows: [{ rank: 5, code: '028050', name: '삼성E&A', price: 64900, changePct: 23.6, marketCap: 1.27e12, tradingValue: 1.5e11, tvToMcapPct: 12, junk: 'x' }],
  });
  assert.equal(board.date, '2026-05-07');
  assert.equal(board.source, 'naver');
  const r = board.rows[0];
  assert.equal(r.junk, undefined);
  assert.deepEqual(Object.keys(r.manual).sort(), [...MANUAL_FIELDS].sort());
});

// --- dailyTheme ---
test('inferRowTheme: manual/notes 테마를 broad theme로 정규화', () => {
  assert.equal(inferRowTheme({ manual: { theme: 'mlcc' } }), '반도체/HBM');
  assert.equal(inferRowTheme({ manual: { notes: '(테마) 반도체(메모리)\n재료: x' } }), '반도체/HBM');
  assert.equal(inferRowTheme({ name: 'SK이노베이션', manual: { notes: '(테마) 확인 필요' } }), '원전/에너지');
});

test('dailyThemeEligibleRows: 상승 + 거래대금 4천억 이상을 먼저 거른 뒤 등락률 상위 30개만 포함', () => {
  const rows = [
    { code: 'A', rank: 100, changePct: 1.2, tradingValue: 500_000_000_000 },
    { code: 'B', rank: 31, changePct: 5, tradingValue: 900_000_000_000 },
    { code: 'C', rank: 2, changePct: -1, tradingValue: 900_000_000_000 },
    { code: 'D', rank: 3, changePct: 2, tradingValue: 399_999_999_999 },
  ];
  assert.deepEqual(dailyThemeEligibleRows(rows).map((r) => r.code), ['B', 'A']);
});

test('dailyThemeEligibleRows: 유동성 필터 후 등락률 상위 30개로 제한', () => {
  const rows = Array.from({ length: 31 }, (_, i) => ({
    code: `C${i}`,
    rank: i + 1,
    changePct: 100 - i,
    tradingValue: 500_000_000_000,
  }));
  const out = dailyThemeEligibleRows(rows);
  assert.equal(out.length, 30);
  assert.equal(out[0].code, 'C0');
  assert.equal(out.at(-1).code, 'C29');
});

test('buildDailyTheme: 유동성 종목의 테마 개수 기준으로 오늘의 테마 산출', () => {
  const rows = [
    { code: '000660', name: 'SK하이닉스', rank: 80, changePct: 3.1, tradingValue: 700_000_000_000, manual: { notes: '(테마) 반도체(메모리)' } },
    { code: '005930', name: '삼성전자', rank: 90, changePct: 1.2, tradingValue: 500_000_000_000, manual: { theme: '반도체(종합)' } },
    { code: '034020', name: '두산에너빌리티', rank: 3, changePct: -2, tradingValue: 600_000_000_000, manual: { theme: '원전' } }, // 하락 제외
    { code: '047810', name: '한국항공우주', rank: 31, changePct: 4, tradingValue: 800_000_000_000, manual: { theme: '방산' } },
    { code: '105560', name: 'KB금융', rank: 4, changePct: 2.3, tradingValue: 900_000_000_000, manual: { theme: '금융' } },
  ];
  const d = buildDailyTheme(rows, { now: '2026-07-13T00:00:00Z' });
  assert.equal(d.source, 'auto');
  assert.equal(d.criteria.rankLimit, 30);
  assert.equal(d.criteria.minTradingValue, 400_000_000_000);
  assert.equal(d.criteria.rankBasis, 'changePctDescAfterLiquidityFilter');
  assert.equal(d.criteria.scoring, 'themeStockCount');
  assert.equal(d.universe.eligibleCount, 4);
  assert.equal(d.items[0].theme, '반도체/HBM');
  assert.equal(d.items[0].count, 2);
  assert.equal(d.items[0].sharePct, 50);
  assert.equal(d.items[0].tradingValue, 1_200_000_000_000);
  assert.equal(d.items[0].topStocks[0].code, '000660');
  assert.equal(d.items[1].theme, '금융/증권'); // 동률이면 거래대금 합계 우선
  assert.ok(d.text.includes('반도체/HBM 2종목(50%)'));
});

test('applyDailyThemePatch: 날짜 단위 테마를 manual source로 저장', () => {
  const board = { date: '2026-07-13', rows: [], dailyTheme: buildDailyTheme([]) };
  const next = applyDailyThemePatch(board, { text: '반도체/HBM 중심' }, { now: 'NOW' });
  assert.equal(next.dailyTheme.source, 'manual');
  assert.equal(next.dailyTheme.text, '반도체/HBM 중심');
  assert.equal(next.dailyTheme.updatedAt, 'NOW');
});
