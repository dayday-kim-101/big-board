// 종목코드 팝업 자유 메모(notes) 선작성 코어 — 순수 함수(네트워크·파일 IO 없음, 테스트 대상).
//
// 목적: 최근 N개월 구간 보드(거래대금 상위 topN)를 code 기준 합집합·중복제거해 대상 종목을 산출하고,
//       code→notes(여러 줄 문자열) seed를 각 보드 행의 '빈' notes 에만 채운다.
//
// 절대 불변식:
//   1) 구조화 manual 7필드(newOrExisting/theme/material/materialPersistence/
//      materialContinuity/financials/supplyDemand)는 절대 읽기 외 수정하지 않는다.
//   2) 이미 값이 있는 notes 는 절대 덮어쓰지 않는다(빈 notes 에만 작성).
//
// 구간·집계 유틸은 jaelyo-prefill-core.js 의 순수 함수를 그대로 재사용한다.
import { STRUCTURED_FIELDS } from './restore-jaelyo-manual-core.js';
import { sanitizeManual } from '../functions/api/_jaelyo-core.js';

export { monthsBackCutoff, datesInRange, aggregateTopCodes } from './jaelyo-prefill-core.js';

// 한 행 manual 의 빈 notes 만 seed 텍스트로 채운다. 구조화 7필드·비어있지 않은 notes 는 불변.
// 반환: { manual(8키 정제됨), filled(true=채움) }.
export function prefillNotes(existingManual, notesText) {
  const base = sanitizeManual(existingManual); // 8키 보장 + trim(구조화 값은 그대로 보존)
  const text = String(notesText ?? '').trim();
  if (base.notes !== '' || text === '') return { manual: base, filled: false };
  return { manual: { ...base, notes: text }, filled: true };
}

// 보드 전체에 notesByCode(code→notes) 적용. 원본 rows 순서/필드 보존, 빈 notes 만 채움.
// 반환: { board, filledCount(채운 notes 수 = 행 수), rowsTouched }.
export function applyNotesToBoard(board, notesByCode) {
  const rows = Array.isArray(board?.rows) ? board.rows : [];
  let filledCount = 0;
  const nextRows = rows.map((r) => {
    const text = notesByCode?.[String(r?.code)];
    if (!text) return r;
    const { manual, filled } = prefillNotes(r.manual, text);
    if (filled) filledCount += 1;
    return { ...r, manual };
  });
  return { board: { ...board, rows: nextRows }, filledCount, rowsTouched: filledCount };
}

// 두 manual 의 구조화 7필드가 동일한지(정제 후 문자열 일치). notes 변경 검증용.
export function structuredEqual(a, b) {
  const x = sanitizeManual(a);
  const y = sanitizeManual(b);
  return STRUCTURED_FIELDS.every((k) => x[k] === y[k]);
}
