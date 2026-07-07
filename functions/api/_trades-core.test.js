// _trades-core.js 순수 헬퍼 테스트 — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tradesPath,
  emptyTrades,
  sanitizeRecordManual,
  sanitizeResultTag,
  normalizeTrades,
  mergeDayRecords,
  applyRecordManual,
} from './_trades-core.js';

// --- tradesPath ---

test('tradesPath: 올바른 경로 생성', () => {
  assert.equal(tradesPath('abc123'), 'data/trades/abc123.json');
});

// --- emptyTrades ---

test('emptyTrades: 올바른 초기값', () => {
  const t = emptyTrades();
  assert.equal(t.version, 1);
  assert.equal(t.updatedAt, null);
  assert.deepEqual(t.days, {});
});

// --- sanitizeRecordManual ---

test('sanitizeRecordManual: reason trim, 2000자 상한', () => {
  const long = 'a'.repeat(3000);
  const out = sanitizeRecordManual({ reason: `  ${long}  ` });
  assert.equal(out.reason.length, 2000);
  assert.equal(out.reason[0], 'a');
});

test('sanitizeRecordManual: tags 중복제거, 공백 trim, 최대 20개', () => {
  const raw = ['MLCC', 'MLCC', ' 반도체 ', '', '  ', ...Array(25).fill('x')];
  const out = sanitizeRecordManual({ tags: raw });
  assert.ok(out.tags.length <= 20);
  assert.equal(out.tags[0], 'MLCC');
  assert.equal(out.tags[1], '반도체');
  // 중복 MLCC는 한 번만
  assert.equal(out.tags.filter((t) => t === 'MLCC').length, 1);
  // 빈 문자열 제거
  assert.ok(!out.tags.includes(''));
});

test('sanitizeRecordManual: holdDays 정수화, 음수는 0으로', () => {
  assert.equal(sanitizeRecordManual({ holdDays: 3.9 }).holdDays, 3);
  assert.equal(sanitizeRecordManual({ holdDays: -1 }).holdDays, 0);
  assert.equal(sanitizeRecordManual({ holdDays: '5' }).holdDays, 5);
  assert.equal(sanitizeRecordManual({ holdDays: 0 }).holdDays, 0);
});

test('sanitizeRecordManual: undefined 필드는 출력 객체에 없음', () => {
  const out = sanitizeRecordManual({ reason: 'test' });
  assert.equal(out.reason, 'test');
  assert.equal(out.tags, undefined);
  assert.equal(out.holdDays, undefined);
});

test('sanitizeRecordManual: null/비객체 입력은 빈 객체 반환', () => {
  assert.deepEqual(sanitizeRecordManual(null), {});
  assert.deepEqual(sanitizeRecordManual(undefined), {});
  assert.deepEqual(sanitizeRecordManual('string'), {});
});

// --- sanitizeResultTag ---

test('sanitizeResultTag: 허용값 success/failure 통과', () => {
  assert.equal(sanitizeResultTag('success'), 'success');
  assert.equal(sanitizeResultTag('failure'), 'failure');
});

test('sanitizeResultTag: 이상값/빈값/nullish → ""', () => {
  assert.equal(sanitizeResultTag(''), '');
  assert.equal(sanitizeResultTag('win'), '');
  assert.equal(sanitizeResultTag('SUCCESS'), '');
  assert.equal(sanitizeResultTag(undefined), '');
  assert.equal(sanitizeResultTag(null), '');
  assert.equal(sanitizeResultTag(1), '');
  assert.equal(sanitizeResultTag({}), '');
});

// --- normalizeTrades ---

const sampleRecord = {
  code: '001820',
  name: '삼화콘덴서',
  market: 'KR',
  buyAvg: 183700,
  sellAvg: 165200,
  qty: 3,
  buyAmount: 551100,
  sellAmount: 495600,
  fee: 1140,
  pnl: -56640,
  returnPct: -10.28,
  prevClose: 183700,
  holdDays: 0,
  reason: '',
  tags: [],
};

test('normalizeTrades: 유효한 데이터 통과', () => {
  const input = {
    version: 1,
    updatedAt: '2026-06-19T10:00:00Z',
    days: {
      '2026-06-19': {
        journal: '테스트 일지',
        records: [sampleRecord],
      },
    },
  };
  const out = normalizeTrades(input);
  assert.equal(out.version, 1);
  assert.equal(out.updatedAt, '2026-06-19T10:00:00Z');
  assert.equal(out.days['2026-06-19'].journal, '테스트 일지');
  assert.equal(out.days['2026-06-19'].records[0].code, '001820');
  assert.equal(out.days['2026-06-19'].records[0].buyAvg, 183700);
});

test('normalizeTrades: resultTag 허용값 보존', () => {
  const input = {
    version: 1,
    updatedAt: null,
    days: {
      '2026-06-19': { journal: '', resultTag: 'success', records: [sampleRecord] },
      '2026-06-18': { journal: '', resultTag: 'failure', records: [] },
    },
  };
  const out = normalizeTrades(input);
  assert.equal(out.days['2026-06-19'].resultTag, 'success');
  assert.equal(out.days['2026-06-18'].resultTag, 'failure');
});

test('normalizeTrades: resultTag 이상값은 "" 로 정규화', () => {
  const out = normalizeTrades({
    version: 1,
    updatedAt: null,
    days: { '2026-06-19': { journal: '', resultTag: 'win', records: [] } },
  });
  assert.equal(out.days['2026-06-19'].resultTag, '');
});

test('normalizeTrades: resultTag 없는 기존 day는 "" 기본값', () => {
  const out = normalizeTrades({
    version: 1,
    updatedAt: null,
    days: { '2026-06-19': { journal: '테스트', records: [sampleRecord] } },
  });
  assert.equal(out.days['2026-06-19'].resultTag, '');
});

test('normalizeTrades: 숫자 필드에 NaN/Infinity → throw', () => {
  const badRecord = { ...sampleRecord, buyAvg: 'NaN' };
  // 'NaN' → Number('NaN') = NaN → not finite → throw
  assert.throws(
    () =>
      normalizeTrades({
        version: 1,
        updatedAt: null,
        days: { '2026-06-19': { journal: '', records: [badRecord] } },
      }),
    /숫자 필드/
  );
});

test('normalizeTrades: Infinity 문자열 → throw', () => {
  const badRecord = { ...sampleRecord, pnl: Infinity };
  assert.throws(
    () =>
      normalizeTrades({
        version: 1,
        updatedAt: null,
        days: { '2026-06-19': { journal: '', records: [badRecord] } },
      }),
    /숫자 필드/
  );
});

test('normalizeTrades: null 숫자 필드는 null로 통과', () => {
  const rec = { ...sampleRecord, prevClose: null };
  const out = normalizeTrades({
    version: 1,
    updatedAt: null,
    days: { '2026-06-19': { journal: '', records: [rec] } },
  });
  assert.equal(out.days['2026-06-19'].records[0].prevClose, null);
});

test('normalizeTrades: market 기본값 KR', () => {
  const rec = { ...sampleRecord, market: undefined };
  const out = normalizeTrades({
    version: 1,
    updatedAt: null,
    days: { '2026-06-19': { journal: '', records: [rec] } },
  });
  assert.equal(out.days['2026-06-19'].records[0].market, 'KR');
});

test('normalizeTrades: days가 배열이면 throw', () => {
  assert.throws(() => normalizeTrades({ version: 1, updatedAt: null, days: [] }), /days/);
});

test('normalizeTrades: 최상위 객체가 아니면 throw', () => {
  assert.throws(() => normalizeTrades(null), /객체/);
  assert.throws(() => normalizeTrades('string'), /객체/);
});

test('normalizeTrades: tags 중복 제거, journal 길이 상한', () => {
  const rec = { ...sampleRecord, tags: ['A', 'A', 'B'] };
  const longJournal = 'x'.repeat(20000);
  const out = normalizeTrades({
    version: 1,
    updatedAt: null,
    days: { '2026-06-19': { journal: longJournal, records: [rec] } },
  });
  assert.equal(out.days['2026-06-19'].journal.length, 10000);
  assert.deepEqual(out.days['2026-06-19'].records[0].tags, ['A', 'B']);
});

// --- mergeDayRecords ---

const existingRecs = [
  {
    code: '001820',
    name: '삼화콘덴서',
    market: 'KR',
    buyAvg: 183700,
    sellAvg: 165200,
    qty: 3,
    buyAmount: 551100,
    sellAmount: 495600,
    fee: 1140,
    pnl: -56640,
    returnPct: -10.28,
    prevClose: 183700,
    holdDays: 2,
    reason: '기존 매매이유',
    tags: ['MLCC', '삼화'],
  },
];

test('mergeDayRecords: 동일 code 재-upsert 시 숫자 갱신, reason/tags/holdDays 보존', () => {
  const incoming = [
    {
      code: '001820',
      name: '삼화콘덴서',
      buyAvg: 190000,
      sellAvg: 170000,
      qty: 5,
      buyAmount: 950000,
      sellAmount: 850000,
      fee: 2000,
      pnl: -100000,
      returnPct: -11.0,
      prevClose: 190000,
    },
  ];
  const result = mergeDayRecords(existingRecs, incoming);
  assert.equal(result.length, 1);
  // 숫자 갱신
  assert.equal(result[0].buyAvg, 190000);
  assert.equal(result[0].qty, 5);
  // 수동필드 보존
  assert.equal(result[0].reason, '기존 매매이유');
  assert.deepEqual(result[0].tags, ['MLCC', '삼화']);
  assert.equal(result[0].holdDays, 2);
});

test('mergeDayRecords: 새 code 추가 (append)', () => {
  const incoming = [
    {
      code: '005930',
      name: '삼성전자',
      market: 'KR',
      buyAvg: 70000,
      sellAvg: 75000,
      qty: 10,
      buyAmount: 700000,
      sellAmount: 750000,
      fee: 500,
      pnl: 49500,
      returnPct: 7.07,
      prevClose: 69500,
    },
  ];
  const result = mergeDayRecords(existingRecs, incoming);
  assert.equal(result.length, 2);
  assert.equal(result[1].code, '005930');
  // 신규 code의 수동필드 기본값
  assert.equal(result[1].reason, '');
  assert.deepEqual(result[1].tags, []);
  assert.equal(result[1].holdDays, 0);
});

test('mergeDayRecords: 빈 existing + incoming → incoming만', () => {
  const result = mergeDayRecords([], [{ code: 'ABC', name: 'test', buyAvg: 100 }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].code, 'ABC');
});

test('mergeDayRecords: null/undefined 입력 허용', () => {
  assert.deepEqual(mergeDayRecords(null, null), []);
  assert.deepEqual(mergeDayRecords(undefined, undefined), []);
});

test('mergeDayRecords: 기존 records 원본 불변', () => {
  const orig = [{ code: '001820', reason: '원본', tags: ['A'], holdDays: 1 }];
  mergeDayRecords(orig, [{ code: '001820', buyAvg: 999 }]);
  assert.equal(orig[0].reason, '원본'); // 원본 변경 없음
});

// --- applyRecordManual ---

const sampleDay = {
  journal: '일지',
  records: [
    { code: '001820', name: '삼화콘덴서', reason: '', tags: [], holdDays: 0 },
    { code: '005930', name: '삼성전자', reason: '기존이유', tags: ['반도체'], holdDays: 3 },
  ],
};

test('applyRecordManual: 지정 code의 manual 필드 부분 병합', () => {
  const next = applyRecordManual(sampleDay, '001820', { reason: '새 이유', tags: ['MLCC'] });
  assert.equal(next.records[0].reason, '새 이유');
  assert.deepEqual(next.records[0].tags, ['MLCC']);
  // 다른 행 불변
  assert.equal(next.records[1].reason, '기존이유');
  assert.deepEqual(next.records[1].tags, ['반도체']);
  assert.equal(next.records[1].holdDays, 3);
});

test('applyRecordManual: holdDays 패치', () => {
  const next = applyRecordManual(sampleDay, '001820', { holdDays: 5 });
  assert.equal(next.records[0].holdDays, 5);
  // 다른 필드 불변
  assert.equal(next.records[0].reason, '');
});

test('applyRecordManual: 없는 code → throw', () => {
  assert.throws(
    () => applyRecordManual(sampleDay, '999999', { reason: 'x' }),
    /종목/
  );
});

test('applyRecordManual: day 없음 → throw', () => {
  assert.throws(() => applyRecordManual(null, '001820', {}), /날짜 데이터/);
  assert.throws(() => applyRecordManual({ records: null }, '001820', {}), /날짜 데이터/);
});

test('applyRecordManual: 원본 day 불변 (순수 함수)', () => {
  const day = { journal: '원본', records: [{ code: '001820', reason: '원본' }] };
  applyRecordManual(day, '001820', { reason: '변경' });
  assert.equal(day.records[0].reason, '원본');
});

test('applyRecordManual: sanitizeRecordManual 통과 — tags 중복 제거', () => {
  const day = { journal: '', records: [{ code: 'A', reason: '', tags: [], holdDays: 0 }] };
  const next = applyRecordManual(day, 'A', { tags: ['X', 'X', 'Y'] });
  assert.deepEqual(next.records[0].tags, ['X', 'Y']);
});
