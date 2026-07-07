// trades.js 순수 헬퍼 테스트 — node --test
// 네트워크 없이 검증 가능한 순수 부분만 커버.
// (jaelyo.test.js / list.test.js 스타일)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidDate } from './trades.js';
import { autoFillHoldDaysForUpsert, mergeDayRecords } from './_trades-core.js';

// --- isValidDate ---

test('isValidDate: YYYY-MM-DD만 통과', () => {
  assert.equal(isValidDate('2026-06-19'), true);
  assert.equal(isValidDate('2026-1-1'), false);
  assert.equal(isValidDate('20260619'), false);
  assert.equal(isValidDate(''), false);
  assert.equal(isValidDate(null), false);
  assert.equal(isValidDate(undefined), false);
});

test('isValidDate: 경로 탈출 형태 거부', () => {
  for (const bad of ['../../foo', '2026-06-19/../x', '2026-06-19.json', '..%2F..']) {
    assert.equal(isValidDate(bad), false, bad);
  }
});

// --- op 분기 검증 (순수 로직 재현) ---
// trades.js 핸들러 내부 op 분기 로직을 인라인 순수함수로 검증.
// 실제 핸들러는 네트워크 의존이지만, op 판별 자체는 여기서 커버.

function validateOp(body) {
  const op = body?.op;
  if (!op) return { ok: false, status: 422, error: 'op 필드 필요 (upsert|manual|journal|resultTag)' };
  if (op === 'upsert') {
    if (!Array.isArray(body.records))
      return { ok: false, status: 422, error: 'upsert op: records 배열 필요' };
    return { ok: true, op };
  }
  if (op === 'resultTag') {
    if (body.resultTag === undefined)
      return { ok: false, status: 422, error: 'resultTag op: resultTag 필드 필요' };
    return { ok: true, op };
  }
  if (op === 'manual') {
    const code = String(body?.code ?? '').trim();
    if (!code) return { ok: false, status: 422, error: 'manual op: code 필요' };
    if (!body?.manual || typeof body.manual !== 'object')
      return { ok: false, status: 422, error: 'manual op: manual 객체 필요' };
    return { ok: true, op };
  }
  if (op === 'journal') {
    if (body.journal === undefined)
      return { ok: false, status: 422, error: 'journal op: journal 필드 필요' };
    return { ok: true, op };
  }
  return { ok: false, status: 422, error: `알 수 없는 op: ${op}` };
}

test('op 검증: op 없으면 422', () => {
  const r = validateOp({});
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.match(r.error, /op 필드/);
});

test('op 검증: upsert + records 배열 → ok', () => {
  const r = validateOp({ op: 'upsert', records: [] });
  assert.equal(r.ok, true);
  assert.equal(r.op, 'upsert');
});

test('op 검증: upsert + records 누락 → 422', () => {
  const r = validateOp({ op: 'upsert' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.match(r.error, /records 배열/);
});

test('op 검증: upsert + records 배열 아님 → 422', () => {
  const r = validateOp({ op: 'upsert', records: 'bad' });
  assert.equal(r.ok, false);
  assert.match(r.error, /records 배열/);
});

test('op 검증: manual + code + manual 객체 → ok', () => {
  const r = validateOp({ op: 'manual', code: '001820', manual: { reason: 'test' } });
  assert.equal(r.ok, true);
  assert.equal(r.op, 'manual');
});

test('op 검증: manual + code 없음 → 422', () => {
  const r = validateOp({ op: 'manual', manual: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /code 필요/);
});

test('op 검증: manual + manual 객체 없음 → 422', () => {
  const r = validateOp({ op: 'manual', code: '001820' });
  assert.equal(r.ok, false);
  assert.match(r.error, /manual 객체/);
});

test('op 검증: manual + manual 문자열(비객체) → 422', () => {
  const r = validateOp({ op: 'manual', code: '001820', manual: 'bad' });
  assert.equal(r.ok, false);
  assert.match(r.error, /manual 객체/);
});

test('op 검증: journal + journal 필드 → ok', () => {
  const r = validateOp({ op: 'journal', journal: '일지 내용' });
  assert.equal(r.ok, true);
  assert.equal(r.op, 'journal');
});

test('op 검증: journal + journal 필드 빈 문자열도 ok', () => {
  const r = validateOp({ op: 'journal', journal: '' });
  assert.equal(r.ok, true);
});

test('op 검증: journal + journal 누락 → 422', () => {
  const r = validateOp({ op: 'journal' });
  assert.equal(r.ok, false);
  assert.match(r.error, /journal 필드/);
});

test('op 검증: resultTag + resultTag 필드 → ok', () => {
  const r = validateOp({ op: 'resultTag', resultTag: 'success' });
  assert.equal(r.ok, true);
  assert.equal(r.op, 'resultTag');
});

test('op 검증: resultTag + 빈 문자열도 ok (태그 해제)', () => {
  const r = validateOp({ op: 'resultTag', resultTag: '' });
  assert.equal(r.ok, true);
  assert.equal(r.op, 'resultTag');
});

test('op 검증: resultTag + resultTag 누락 → 422', () => {
  const r = validateOp({ op: 'resultTag' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.match(r.error, /resultTag 필드/);
});

test('op 검증: 알 수 없는 op → 422', () => {
  const r = validateOp({ op: 'delete' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 422);
  assert.match(r.error, /알 수 없는 op/);
});

test('op 검증: 알 수 없는 op (null) → 422', () => {
  const r = validateOp({ op: null });
  assert.equal(r.ok, false);
  assert.match(r.error, /op 필드/);
});

// --- upsert 경로 통합: autoFillHoldDaysForUpsert → mergeDayRecords ---
// 핸들러 upsert 분기는 body.records를 autoFill 후 mergeDayRecords로 병합한다.
// 여기서 그 조합(순수 부분)을 그대로 재현해 간접 검증.

function upsertRecords(days, date, incomingRecords) {
  const existingDay = days[date] ?? { journal: '', resultTag: '', records: [] };
  const filled = autoFillHoldDaysForUpsert(days, date, incomingRecords);
  return mergeDayRecords(existingDay.records, filled);
}

test('upsert 경로: 새 매도 row는 자동 계산된 holdDays로 저장', () => {
  const days = {
    '2026-06-17': { journal: '', resultTag: '', records: [{ code: '001820', buyAvg: 100 }] },
  };
  const records = upsertRecords(days, '2026-06-19', [
    { code: '001820', sellAvg: 110, returnPct: 10 },
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].holdDays, 2); // 06-17 매수 → 06-19 매도 = 2일
});

test('upsert 경로: 기존 date/code의 수동 holdDays는 merge 정책대로 보존', () => {
  const days = {
    '2026-06-17': { journal: '', resultTag: '', records: [{ code: '001820', buyAvg: 100 }] },
    // 이미 매도일에 같은 code가 있고 수동 holdDays=9 설정됨
    '2026-06-19': {
      journal: '',
      resultTag: '',
      records: [{ code: '001820', sellAvg: 110, returnPct: 10, holdDays: 9, reason: '기존이유' }],
    },
  };
  const records = upsertRecords(days, '2026-06-19', [
    { code: '001820', sellAvg: 111, returnPct: 11 },
  ]);
  // 숫자 필드는 갱신되지만 수동 holdDays/reason은 보존
  assert.equal(records[0].sellAvg, 111);
  assert.equal(records[0].holdDays, 9);
  assert.equal(records[0].reason, '기존이유');
});

test('upsert 경로: 당일 매수+매도 새 row → holdDays 0 저장', () => {
  const records = upsertRecords({}, '2026-06-19', [
    { code: '005930', buyAvg: 70000, sellAvg: 71000, returnPct: 1.4 },
  ]);
  assert.equal(records[0].holdDays, 0);
});
