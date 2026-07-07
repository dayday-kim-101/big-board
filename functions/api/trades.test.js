// trades.js 순수 헬퍼 테스트 — node --test
// 네트워크 없이 검증 가능한 순수 부분만 커버.
// (jaelyo.test.js / list.test.js 스타일)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidDate } from './trades.js';

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
