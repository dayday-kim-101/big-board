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

// 신규 종목(notes-seed·글로벌 메모 없음)용 보수적 기본 자유 메모(여러 줄).
// 구체 재료를 단정하지 않고 '확인 필요'만 남긴다 → 사용자가 나중에 실제 재료로 대체.
// 형식은 기존 notes(테마/재료/세계/국내/체크 5줄)와 동일. 종목명 없으면 code 사용.
export function buildDefaultNoteForRow(row) {
  const name = String(row?.name ?? '').trim() || String(row?.code ?? '').trim();
  return [
    '(테마) 확인 필요',
    `재료: ${name} — 재료정리 거래대금 상위권 편입, 구체 재료 확인 필요`,
    '세계: 확인 필요',
    '국내: 거래대금 상위권 편입, 수급·뉴스 확인 필요',
    '체크: 재료 지속성, 실적/재무, 공시·뉴스 원문, 수급 연속성 확인 필요',
  ].join('\n');
}

// rows 각각에 대해 code→notes seed map 을 만든다.
// 우선순위: seedByCode[code](non-empty, notes-seed+글로벌+dated 병합) > buildDefaultNoteForRow(row).
// 이 map 은 applyNotesToBoard 로 '빈 notes' 에만 적용되므로 기존 notes 는 절대 덮이지 않는다.
export function ensureNotesForRows(rows, seedByCode = {}) {
  const seed = seedByCode || {};
  const out = {};
  for (const r of rows ?? []) {
    const code = String(r?.code ?? '').trim();
    if (!code) continue;
    const seeded = String(seed[code] ?? '').trim();
    out[code] = seeded !== '' ? seeded : buildDefaultNoteForRow(r);
  }
  return out;
}

// 각 행의 '빈' notes 에만 보수적 기본 메모를 채운 결과.
// 반환: { rows(빈 notes만 기본 메모로 채움), generated: {code: note}(새로 생성한 것만) }.
// 이미 notes 가 있는 행은 원본 그대로 반환(불변). 구조화 7필드 불변.
// generated 는 code-level 글로벌 메모(manual-by-code.json) 영속용으로 호출부가 쓴다.
export function fillMissingNotes(rows) {
  const generated = {};
  const out = (rows ?? []).map((r) => {
    const base = sanitizeManual(r?.manual);
    if (base.notes !== '') return r;
    const code = String(r?.code ?? '').trim();
    const note = buildDefaultNoteForRow(r);
    if (code) generated[code] = note;
    return { ...r, manual: { ...base, notes: note } };
  });
  return { rows: out, generated };
}

// 두 manual 의 구조화 7필드가 동일한지(정제 후 문자열 일치). notes 변경 검증용.
export function structuredEqual(a, b) {
  const x = sanitizeManual(a);
  const y = sanitizeManual(b);
  return STRUCTURED_FIELDS.every((k) => x[k] === y[k]);
}
