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
  autoFillHoldDaysForUpsert,
  autoFillDerivedFieldsForUpsert,
  isBuyRecord,
  isSellRecord,
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

// --- isBuyRecord / isSellRecord ---

test('isBuyRecord: buyAvg/buyAmount 양수면 true', () => {
  assert.equal(isBuyRecord({ buyAvg: 1000 }), true);
  assert.equal(isBuyRecord({ buyAmount: 5000 }), true);
  assert.equal(isBuyRecord({ buyAvg: 0 }), false);
  assert.equal(isBuyRecord({ sellAvg: 1000 }), false);
  assert.equal(isBuyRecord({}), false);
  assert.equal(isBuyRecord(null), false);
});

test('isSellRecord: sellAvg/sellAmount/qty 양수 또는 returnPct 유효 숫자면 true', () => {
  assert.equal(isSellRecord({ sellAvg: 1000 }), true);
  assert.equal(isSellRecord({ sellAmount: 5000 }), true);
  assert.equal(isSellRecord({ qty: 3 }), true); // qty는 매도수량(청산 수량)
  assert.equal(isSellRecord({ returnPct: -10.5 }), true); // 음수 수익률도 청산
  assert.equal(isSellRecord({ returnPct: 0 }), true);
  assert.equal(isSellRecord({ buyAvg: 1000 }), false); // 매수-only는 청산 아님
  assert.equal(isSellRecord({}), false);
  assert.equal(isSellRecord(null), false);
});

// --- autoFillHoldDaysForUpsert ---

test('autoFillHoldDaysForUpsert: (a) 같은 record 안 매수+매도 → holdDays 0', () => {
  const incoming = [{ code: '001820', buyAvg: 100, sellAvg: 110, returnPct: 10 }];
  const out = autoFillHoldDaysForUpsert({}, '2026-06-19', incoming);
  assert.equal(out[0].holdDays, 0);
});

test('autoFillHoldDaysForUpsert: (b) 전날 매수, 다음날 매도 → holdDays 1', () => {
  const days = {
    '2026-06-18': { records: [{ code: '001820', buyAvg: 100 }] },
  };
  const incoming = [{ code: '001820', sellAvg: 110, returnPct: 10 }];
  const out = autoFillHoldDaysForUpsert(days, '2026-06-19', incoming);
  assert.equal(out[0].holdDays, 1);
});

test('autoFillHoldDaysForUpsert: (c) 여러 이전 매수일 → 가장 최근 매수일 기준', () => {
  const days = {
    '2026-06-10': { records: [{ code: '001820', buyAvg: 90 }] },
    '2026-06-17': { records: [{ code: '001820', buyAvg: 100 }] },
    // 다른 종목은 무시
    '2026-06-18': { records: [{ code: '005930', buyAvg: 70000 }] },
  };
  const incoming = [{ code: '001820', sellAvg: 110, returnPct: 10 }];
  const out = autoFillHoldDaysForUpsert(days, '2026-06-19', incoming);
  // 가장 최근 매수일 2026-06-17 기준 → 2일
  assert.equal(out[0].holdDays, 2);
});

test('autoFillHoldDaysForUpsert: (d) 같은 날짜 기존 매수, incoming 매도 → 0', () => {
  const days = {
    '2026-06-19': { records: [{ code: '001820', buyAvg: 100 }] },
  };
  const incoming = [{ code: '001820', sellAvg: 110, returnPct: 10 }];
  const out = autoFillHoldDaysForUpsert(days, '2026-06-19', incoming);
  assert.equal(out[0].holdDays, 0);
});

test('autoFillHoldDaysForUpsert: (e) 참조 매수일 없으면 incoming holdDays 보존', () => {
  const incoming = [{ code: '001820', sellAvg: 110, returnPct: 10, holdDays: 5 }];
  const out = autoFillHoldDaysForUpsert({}, '2026-06-19', incoming);
  assert.equal(out[0].holdDays, 5);
});

test('autoFillHoldDaysForUpsert: (e2) 참조 매수일 없고 holdDays 없으면 0', () => {
  const incoming = [{ code: '001820', sellAvg: 110, returnPct: 10 }];
  const out = autoFillHoldDaysForUpsert({}, '2026-06-19', incoming);
  assert.equal(out[0].holdDays, 0);
});

test('autoFillHoldDaysForUpsert: (f) 매수-only incoming은 자동 증가하지 않음', () => {
  const days = {
    '2026-06-10': { records: [{ code: '001820', buyAvg: 90 }] },
  };
  // 이전 매수 기록이 있어도 매수-only는 청산이 아니므로 홀드일 계산 대상 아님
  const incoming = [{ code: '001820', buyAvg: 100 }];
  const out = autoFillHoldDaysForUpsert(days, '2026-06-19', incoming);
  assert.equal(out[0].holdDays, 0);
});

test('autoFillHoldDaysForUpsert: qty만 있는 매도 row도 이전 매수일 기준 계산', () => {
  const days = {
    '2026-06-18': { records: [{ code: '001820', buyAvg: 100 }] },
  };
  const incoming = [{ code: '001820', qty: 3 }];
  const out = autoFillHoldDaysForUpsert(days, '2026-06-19', incoming);
  assert.equal(out[0].holdDays, 1);
});

test('autoFillHoldDaysForUpsert: 매수-only는 기존 rec.holdDays 정제값 유지', () => {
  const incoming = [{ code: '001820', buyAvg: 100, holdDays: 4 }];
  const out = autoFillHoldDaysForUpsert({}, '2026-06-19', incoming);
  assert.equal(out[0].holdDays, 4);
});

test('autoFillHoldDaysForUpsert: 이후 날짜 매수는 참조하지 않음', () => {
  const days = {
    '2026-06-20': { records: [{ code: '001820', buyAvg: 100 }] }, // 매도일 이후
  };
  const incoming = [{ code: '001820', sellAvg: 110, returnPct: 10, holdDays: 7 }];
  const out = autoFillHoldDaysForUpsert(days, '2026-06-19', incoming);
  // 참조 매수일 없음 → 기존 holdDays 보존
  assert.equal(out[0].holdDays, 7);
});

test('autoFillHoldDaysForUpsert: 원본 incoming 불변(순수 함수)', () => {
  const incoming = [{ code: '001820', sellAvg: 110, returnPct: 10, holdDays: 5 }];
  autoFillHoldDaysForUpsert({}, '2026-06-19', incoming);
  assert.equal(incoming[0].holdDays, 5);
});

test('autoFillHoldDaysForUpsert: 비배열 incoming → 빈 배열', () => {
  assert.deepEqual(autoFillHoldDaysForUpsert({}, '2026-06-19', null), []);
  assert.deepEqual(autoFillHoldDaysForUpsert({}, '2026-06-19', undefined), []);
});

// --- autoFillDerivedFieldsForUpsert: returnPct 자동 계산 ---
// autoFillHoldDaysForUpsert는 이 함수의 별칭이므로 holdDays 동작은 위에서 이미 커버됨.

test('autoFillDerivedFieldsForUpsert: 별칭이 동일 함수', () => {
  assert.equal(autoFillHoldDaysForUpsert, autoFillDerivedFieldsForUpsert);
});

test('autoFillDerivedFieldsForUpsert: (a) 전날 buyAvg=100, 다음날 sellAvg=110, returnPct 없음 → 10', () => {
  const days = { '2026-06-18': { records: [{ code: '001820', buyAvg: 100 }] } };
  const out = autoFillDerivedFieldsForUpsert(days, '2026-06-19', [{ code: '001820', sellAvg: 110 }]);
  assert.equal(out[0].returnPct, 10);
  assert.equal(out[0].holdDays, 1);
});

test('autoFillDerivedFieldsForUpsert: (b) 전날 buyAvg=100, 다음날 sellAvg=95 → -5', () => {
  const days = { '2026-06-18': { records: [{ code: '001820', buyAvg: 100 }] } };
  const out = autoFillDerivedFieldsForUpsert(days, '2026-06-19', [{ code: '001820', sellAvg: 95 }]);
  assert.equal(out[0].returnPct, -5);
});

test('autoFillDerivedFieldsForUpsert: (b2) 소수 2자리 반올림', () => {
  const days = { '2026-06-18': { records: [{ code: '001820', buyAvg: 200 }] } };
  const out = autoFillDerivedFieldsForUpsert(days, '2026-06-19', [{ code: '001820', sellAvg: 189.5 }]);
  // ((189.5 - 200) / 200) * 100 = -5.25
  assert.equal(out[0].returnPct, -5.25);
});

test('autoFillDerivedFieldsForUpsert: (c) 같은 incoming buyAvg=100/sellAvg=110 → returnPct 10, holdDays 0', () => {
  const out = autoFillDerivedFieldsForUpsert({}, '2026-06-19', [
    { code: '001820', buyAvg: 100, sellAvg: 110 },
  ]);
  assert.equal(out[0].returnPct, 10);
  assert.equal(out[0].holdDays, 0);
});

test('autoFillDerivedFieldsForUpsert: (d) 같은 date 기존 buyAvg=100, incoming sellAvg=110 → returnPct 10', () => {
  const days = { '2026-06-19': { records: [{ code: '001820', buyAvg: 100 }] } };
  const out = autoFillDerivedFieldsForUpsert(days, '2026-06-19', [{ code: '001820', sellAvg: 110 }]);
  assert.equal(out[0].returnPct, 10);
  assert.equal(out[0].holdDays, 0);
});

test('autoFillDerivedFieldsForUpsert: (e) incoming returnPct 이미 7.77 → 보존', () => {
  const days = { '2026-06-18': { records: [{ code: '001820', buyAvg: 100 }] } };
  const out = autoFillDerivedFieldsForUpsert(days, '2026-06-19', [
    { code: '001820', sellAvg: 110, returnPct: 7.77 },
  ]);
  // 참조 buyAvg=100으로 10이 계산 가능하지만, 기존 값 보존이 우선.
  assert.equal(out[0].returnPct, 7.77);
});

test('autoFillDerivedFieldsForUpsert: (f) 참조 buyAvg 없으면 returnPct 미설정', () => {
  const out = autoFillDerivedFieldsForUpsert({}, '2026-06-19', [{ code: '001820', sellAvg: 110 }]);
  assert.equal(out[0].returnPct, undefined);
});

test('autoFillDerivedFieldsForUpsert: (g) 여러 이전 매수 → 가장 최근 buyAvg 기준', () => {
  const days = {
    '2026-06-10': { records: [{ code: '001820', buyAvg: 90 }] },
    '2026-06-17': { records: [{ code: '001820', buyAvg: 100 }] },
  };
  const out = autoFillDerivedFieldsForUpsert(days, '2026-06-19', [{ code: '001820', sellAvg: 110 }]);
  // 가장 최근 매수 buyAvg=100 기준 → ((110-100)/100)*100 = 10
  assert.equal(out[0].returnPct, 10);
});

test('autoFillDerivedFieldsForUpsert: (h) incoming buyAvg 비어있으면 참조 buyAvg로 채움', () => {
  const days = { '2026-06-18': { records: [{ code: '001820', buyAvg: 100 }] } };
  const out = autoFillDerivedFieldsForUpsert(days, '2026-06-19', [{ code: '001820', sellAvg: 110 }]);
  assert.equal(out[0].buyAvg, 100);
  assert.equal(out[0].returnPct, 10);
});

test('autoFillDerivedFieldsForUpsert: (h2) incoming buyAvg 있으면 참조로 덮어쓰지 않음', () => {
  const days = { '2026-06-18': { records: [{ code: '001820', buyAvg: 100 }] } };
  const out = autoFillDerivedFieldsForUpsert(days, '2026-06-19', [
    { code: '001820', buyAvg: 105, sellAvg: 110 },
  ]);
  // 같은 record에 buyAvg가 있으므로 그 값(105) 기준으로 계산, 덮어쓰기 없음.
  assert.equal(out[0].buyAvg, 105);
  assert.equal(out[0].returnPct, Math.round(((110 - 105) / 105) * 100 * 100) / 100);
});

test('autoFillDerivedFieldsForUpsert: 매수-only는 returnPct/buyAvg 보정 안 함', () => {
  const days = { '2026-06-18': { records: [{ code: '001820', buyAvg: 90 }] } };
  const out = autoFillDerivedFieldsForUpsert(days, '2026-06-19', [{ code: '001820', buyAvg: 100 }]);
  assert.equal(out[0].returnPct, undefined);
  assert.equal(out[0].buyAvg, 100);
});

test('autoFillDerivedFieldsForUpsert: 원본 incoming 불변(순수 함수)', () => {
  const days = { '2026-06-18': { records: [{ code: '001820', buyAvg: 100 }] } };
  const incoming = [{ code: '001820', sellAvg: 110 }];
  autoFillDerivedFieldsForUpsert(days, '2026-06-19', incoming);
  assert.equal(incoming[0].returnPct, undefined);
  assert.equal(incoming[0].buyAvg, undefined);
});
