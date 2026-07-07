// jaelyo Function 순수 헬퍼 테스트 — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDirDates, applyManualPatch, isValidDate, mergeBoardWithGlobal } from './jaelyo.js';
import { normalizeBoard, sanitizeManual } from './_jaelyo-core.js';

test('isValidDate: YYYY-MM-DD만 통과', () => {
  assert.equal(isValidDate('2026-05-07'), true);
  assert.equal(isValidDate('2026-5-7'), false);
  assert.equal(isValidDate('20260507'), false);
  assert.equal(isValidDate(''), false);
  assert.equal(isValidDate(null), false);
});

test('parseDirDates: *.json만, 날짜 내림차순', () => {
  const items = [
    { name: '2026-05-07.json', type: 'file' },
    { name: '2026-05-09.json', type: 'file' },
    { name: 'README.md', type: 'file' },
    { name: 'bad.json', type: 'file' },
  ];
  const dates = parseDirDates(items);
  assert.deepEqual(dates, ['2026-05-09', '2026-05-07']);
});

test('parseDirDates: 빈/비배열 → []', () => {
  assert.deepEqual(parseDirDates([]), []);
  assert.deepEqual(parseDirDates(null), []);
});

test('applyManualPatch: 해당 code 행의 manual만 부분 병합', () => {
  const board = {
    date: '2026-05-07',
    rows: [
      { code: '028050', name: '삼성E&A', manual: { theme: '건설', material: '수주', newOrExisting: '', materialPersistence: '', materialContinuity: '', financials: '', supplyDemand: '' } },
      { code: '005930', name: '삼성전자', manual: { theme: '', material: '', newOrExisting: '', materialPersistence: '', materialContinuity: '', financials: '', supplyDemand: '' } },
    ],
  };
  const next = applyManualPatch(board, '028050', { material: '신규수주' });
  // 부분 패치: material만 갱신, theme은 보존
  assert.equal(next.rows[0].manual.material, '신규수주');
  assert.equal(next.rows[0].manual.theme, '건설');
  // 다른 행 불변
  assert.equal(next.rows[1].manual.theme, '');
  // 허용되지 않은 키 무시
  const next2 = applyManualPatch(board, '028050', { bogus: 'x', theme: '바이오' });
  assert.equal(next2.rows[0].manual.bogus, undefined);
  assert.equal(next2.rows[0].manual.theme, '바이오');
});

test('applyManualPatch: 없는 code → throw', () => {
  const board = { date: '2026-05-07', rows: [{ code: '028050', manual: {} }] };
  assert.throws(() => applyManualPatch(board, '999999', { theme: 'x' }), /종목/);
});

test('isValidDate: 경로 탈출 형태의 date 거부 (filePath 생성 전 가드)', () => {
  for (const bad of ['../../foo', '2026-06-11/../x', '2026-06-11/..', '..%2F..', '2026-06-11.json']) {
    assert.equal(isValidDate(bad), false, bad);
  }
});

test('applyManualPatch: 프로토타입 오염 키는 sanitize에서 제거', () => {
  const board = { date: '2026-05-07', rows: [{ code: '028050', manual: {} }] };
  const next = applyManualPatch(board, '028050', JSON.parse('{"__proto__":{"polluted":true},"constructor":"x","theme":"건설"}'));
  const m = next.rows[0].manual;
  assert.equal(m.theme, '건설');
  // 화이트리스트(MANUAL_FIELDS) 키만 복사 → 오염 키는 own 속성으로 들어오지 않음
  assert.equal(Object.prototype.hasOwnProperty.call(m, 'polluted'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(m, 'constructor'), false);
  assert.equal(({}).polluted, undefined, '전역 Object 오염 없음');
});

test('mergeBoardWithGlobal: GET 시 빈 필드에 code-level 글로벌 폴백(사용자 값 보존)', () => {
  const board = {
    date: '2026-07-07',
    rows: [
      { code: '005930', manual: sanitizeManual({ theme: '메모리', notes: '' }) }, // notes 빈값
      { code: '111111', manual: sanitizeManual({}) }, // 글로벌에 없음 → 그대로
    ],
  };
  const global = { '005930': sanitizeManual({ theme: 'SEED', material: 'HBM', notes: '이어진 메모' }) };
  const merged = mergeBoardWithGlobal(board, global);
  assert.equal(merged.rows[0].manual.theme, '메모리'); // 행 값 우선
  assert.equal(merged.rows[0].manual.material, 'HBM'); // 빈 필드 폴백
  assert.equal(merged.rows[0].manual.notes, '이어진 메모'); // 빈 notes 폴백
  assert.equal(merged.rows[1].manual.theme, ''); // 글로벌 없음 → 빈값 유지
});

test('PUT 라운드트립(applyManualPatch→normalizeBoard): 패치 행 manual 유지·타 행 불변', () => {
  // jaelyo.js onRequestPut의 핵심 합성을 그대로 검증 — normalizeBoard가 manual을 지우지 않아야 함
  const board = {
    date: '2026-05-07', collectedAt: '2026-05-07T06:40:00Z', source: 'kiwoom',
    rows: [
      { rank: 1, code: '028050', name: '삼성E&A', price: 64900, changePct: 23.6, marketCap: 1.27e12, tradingValue: 5e11, tvToMcapPct: 25, manual: { theme: '건설', material: '수주', newOrExisting: '', materialPersistence: '', materialContinuity: '', financials: '', supplyDemand: '' } },
      { rank: 2, code: '005930', name: '삼성전자', price: 81000, changePct: 1.2, marketCap: 5e14, tradingValue: 1e11, tvToMcapPct: 0.02, manual: { theme: '반도체', material: '', newOrExisting: '기존', materialPersistence: '', materialContinuity: '', financials: '', supplyDemand: '' } },
    ],
  };
  const saved = normalizeBoard(applyManualPatch(board, '028050', { material: '신규수주' }));
  assert.equal(saved.rows[0].manual.material, '신규수주');
  assert.equal(saved.rows[0].manual.theme, '건설'); // 다른 필드 보존
  assert.equal(saved.rows[1].manual.theme, '반도체'); // 다른 행 불변
  assert.equal(saved.rows[0].tradingValue, 5e11); // API 필드 보존
  assert.equal(saved.collectedAt, '2026-05-07T06:40:00Z');
});
