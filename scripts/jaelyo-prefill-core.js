// 재료정리 메모 선작성(prefill) 코어 — 순수 함수(네트워크·파일 IO 없음, 테스트 대상).
//
// 목적: 최근 N개월 구간의 재료정리 보드(거래대금 상위 N)를 code 기준으로 합집합·중복제거하고,
//       seed(code → manual)를 각 보드 행의 '빈' manual 필드에만 병합한다.
//       핵심 불변식: 사용자가 이미 입력한(비어있지 않은) manual 값은 절대 덮어쓰지 않는다.
//
// 보드/manual 스키마는 functions/api/_jaelyo-core.js 를 그대로 따른다(7개 manual 키).
import { MANUAL_FIELDS, sanitizeManual } from '../functions/api/_jaelyo-core.js';

// latest(YYYY-MM-DD) 기준 N개월 전 컷오프 날짜(YYYY-MM-DD, 구간 포함 하한).
// 달력상 개월 빼기 — UTC 기준(날짜 문자열만 쓰므로 타임존 영향 없음).
export function monthsBackCutoff(latest, months) {
  const [y, m, d] = String(latest).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() - months);
  return dt.toISOString().slice(0, 10);
}

// 날짜 문자열 목록에서 [cutoff, latest] 구간(양끝 포함)만 오름차순으로.
export function datesInRange(dates, cutoff, latest) {
  return [...(dates ?? [])].filter((d) => d >= cutoff && d <= latest).sort();
}

// 보드 배열 → code 기준 합집합(각 보드의 상위 topN 행만). 등장 횟수·최고순위 집계.
// 반환: [{ code, name, appearances, bestRank(null 가능) }] (등장 많은 순, 동률은 최고순위 순).
export function aggregateTopCodes(boards, topN = 100) {
  const map = new Map();
  for (const b of boards ?? []) {
    const rows = Array.isArray(b?.rows) ? b.rows.slice(0, topN) : [];
    for (const r of rows) {
      const code = String(r?.code ?? '').trim();
      if (!code) continue;
      const cur = map.get(code) || { code, name: '', appearances: 0, bestRank: Infinity };
      cur.appearances += 1;
      if (r.name) cur.name = String(r.name);
      const rank = Number(r.rank);
      if (Number.isFinite(rank)) cur.bestRank = Math.min(cur.bestRank, rank);
      map.set(code, cur);
    }
  }
  return [...map.values()]
    .map((c) => ({ ...c, bestRank: c.bestRank === Infinity ? null : c.bestRank }))
    .sort((a, b) => b.appearances - a.appearances || (a.bestRank ?? 999) - (b.bestRank ?? 999));
}

// 기존 manual의 '빈' 필드만 seed 값으로 채운다. 비어있지 않은 필드는 절대 건드리지 않음.
// 반환: { manual(7키 정제됨), filled: [채운 필드명...] }.
export function prefillManual(existing, seed) {
  const base = sanitizeManual(existing); // 7키 보장 + 문자열 trim
  const seedClean = sanitizeManual(seed);
  const out = { ...base };
  const filled = [];
  for (const k of MANUAL_FIELDS) {
    if (out[k] === '' && seedClean[k] !== '') {
      out[k] = seedClean[k];
      filled.push(k);
    }
  }
  return { manual: out, filled };
}

// 보드 전체에 seed(code → manual 부분객체) 적용. 원본 rows 순서/필드 보존, manual만 병합.
// 반환: { board, filledCount(채운 필드 총수), rowsTouched(1개 이상 채운 행 수) }.
export function applySeedToBoard(board, seedByCode) {
  const rows = Array.isArray(board?.rows) ? board.rows : [];
  let filledCount = 0;
  let rowsTouched = 0;
  const nextRows = rows.map((r) => {
    const seed = seedByCode?.[String(r?.code)];
    if (!seed) return r;
    const { manual, filled } = prefillManual(r.manual, seed);
    if (filled.length) {
      filledCount += filled.length;
      rowsTouched += 1;
    }
    return { ...r, manual };
  });
  return { board: { ...board, rows: nextRows }, filledCount, rowsTouched };
}
