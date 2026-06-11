// _jaelyo-core 순수 함수 테스트 — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRanking,
  parseBasicInfo,
  computeTvToMcapPct,
  buildRankMap,
  attachPrevRank,
  mergeManual,
  normalizeBoard,
  sanitizeManual,
  emptyManual,
  MANUAL_FIELDS,
} from './_jaelyo-core.js';

// --- parseRanking: 거래대금상위(ka10032) 응답 → 정규화 (거래대금 백만원 → 원) ---
test('parseRanking: 필드 매핑 + 거래대금 백만원→원 환산', () => {
  const json = {
    trde_prica_upper: [
      { rank: '1', stk_cd: '028050', stk_nm: '삼성E&A', cur_prc: '+64900', flu_rt: '+23.60', trde_prica: '152285' },
      { rank: '2', stk_cd: '005930', stk_nm: '삼성전자', cur_prc: '-81000', flu_rt: '-1.20', trde_prica: '1000000' },
    ],
    return_code: 0,
  };
  const rows = parseRanking(json);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    rank: 1, code: '028050', name: '삼성E&A', price: 64900, changePct: 23.6, tradingValue: 152285 * 1_000_000,
  });
  // 현재가는 부호 제거(절대값), 거래대금은 ×1e6
  assert.equal(rows[1].price, 81000);
  assert.equal(rows[1].changePct, -1.2);
  assert.equal(rows[1].tradingValue, 1_000_000 * 1_000_000);
});

test('parseRanking: rank 누락 시 배열 순서로 채움', () => {
  const rows = parseRanking({ trde_prica_upper: [{ stk_cd: '000660', stk_nm: 'SK하이닉스', cur_prc: '200000', flu_rt: '5', trde_prica: '500' }] });
  assert.equal(rows[0].rank, 1);
});

test('parseRanking: 형식 오류 → throw (휴장 가드가 처리 가능)', () => {
  assert.throws(() => parseRanking({}), /형식/);
  assert.throws(() => parseRanking(null), /형식/);
});

test('parseRanking: 빈 배열 → 빈 결과(throw 아님)', () => {
  assert.deepEqual(parseRanking({ trde_prica_upper: [] }), []);
});

// --- parseBasicInfo: 주식기본정보(ka10001) 시가총액(억원) → 원 ---
test('parseBasicInfo: 시총 억원→원 환산', () => {
  assert.equal(parseBasicInfo({ stk_cd: '028050', mac: '12700' }), 12700 * 100_000_000);
});

test('parseBasicInfo: 시총 누락 → null', () => {
  assert.equal(parseBasicInfo({ stk_cd: 'x' }), null);
  assert.equal(parseBasicInfo({ mac: '' }), null);
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

// --- normalizeBoard ---
test('normalizeBoard: 알 수 없는 필드 제거 + manual 항상 존재', () => {
  const board = normalizeBoard({
    date: '2026-05-07',
    collectedAt: '2026-05-07T06:40:00Z',
    rows: [{ rank: 5, code: '028050', name: '삼성E&A', price: 64900, changePct: 23.6, marketCap: 1.27e12, tradingValue: 1.5e11, tvToMcapPct: 12, junk: 'x' }],
  });
  assert.equal(board.date, '2026-05-07');
  assert.equal(board.source, 'kiwoom');
  const r = board.rows[0];
  assert.equal(r.junk, undefined);
  assert.deepEqual(Object.keys(r.manual).sort(), [...MANUAL_FIELDS].sort());
});
