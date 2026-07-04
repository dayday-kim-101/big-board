// 재료정리 수동입력 복구 코어 — 순수 함수(네트워크·파일 IO 없음, 테스트 대상).
//
// 배경: PR #19(seed prefill)가 각 보드의 '빈' 구조화 manual 필드를 자동 seed로 채웠다.
//       사용자는 seed 값을 자신이 작성한 값으로 보지 않는다. 따라서 특정 기준 커밋(old ref,
//       기본 f8fdd2b — #19 이전)의 manual 구조화 필드를 정본으로 삼아 현재 파일을 되돌린다.
//
// 원칙:
//   1) old의 구조화 필드 값을 current로 복원한다(정본).
//      - old가 비어있지 않으면 → 사용자가 작성한 값 → 복원(restored).
//      - old가 비어있는데 current가 채워져 있으면 → seed로 채워진 값 → 초기화(reset).
//   2) 자유 메모(notes)는 old엔 없던 새 팝업 메모이므로 current 값을 그대로 보존한다.
//
// 보드/manual 스키마는 functions/api/_jaelyo-core.js 를 그대로 따른다(8개 manual 키: 구조화 7 + notes).
import { MANUAL_FIELDS, sanitizeManual } from '../functions/api/_jaelyo-core.js';

// 팝업 전용 자유 메모(notes)를 제외한 구조화 필드 7개 — 복구 대상.
export const STRUCTURED_FIELDS = MANUAL_FIELDS.filter((k) => k !== 'notes');

// 한 행의 manual 복구: old의 구조화 필드를 정본으로, current의 notes는 보존.
// 반환: { manual(8키 정제됨), restored: [사용자값 복원 필드...], reset: [seed 제거 필드...] }.
export function restoreManual(oldManual, currentManual) {
  const oldClean = sanitizeManual(oldManual);
  const curClean = sanitizeManual(currentManual);
  const out = { ...curClean }; // notes 등 current 값을 base로 유지
  const restored = [];
  const reset = [];
  for (const k of STRUCTURED_FIELDS) {
    const oldVal = oldClean[k];
    const curVal = curClean[k];
    out[k] = oldVal; // old를 정본으로 덮어씀
    if (oldVal === curVal) continue; // 변화 없음 → 카운트 제외
    if (oldVal !== '') restored.push(k); // old에 사용자값 존재 → 복원
    else reset.push(k); // old 빈값인데 current 채워짐(seed) → 초기화
  }
  // notes는 current 값 유지(out.notes = curClean.notes, 이미 base에 포함).
  return { manual: out, restored, reset };
}

// 보드 전체 복구: current rows를 code 기준으로 old rows의 manual과 대조.
// old에 없는 code는 사용자 데이터가 없으므로 구조화 필드를 모두 초기화(seed 제거).
// 반환: { board, restoredCount, resetCount, rowsTouched }.
export function restoreBoard(oldBoard, currentBoard) {
  const oldByCode = new Map();
  for (const r of oldBoard?.rows ?? []) {
    if (r?.code != null) oldByCode.set(String(r.code), r.manual);
  }
  let restoredCount = 0;
  let resetCount = 0;
  let rowsTouched = 0;
  const rows = (currentBoard?.rows ?? []).map((r) => {
    const oldManual = oldByCode.get(String(r?.code)); // 없으면 undefined → sanitizeManual이 빈 manual
    const { manual, restored, reset } = restoreManual(oldManual, r.manual);
    if (restored.length || reset.length) rowsTouched += 1;
    restoredCount += restored.length;
    resetCount += reset.length;
    return { ...r, manual };
  });
  return { board: { ...currentBoard, rows }, restoredCount, resetCount, rowsTouched };
}
