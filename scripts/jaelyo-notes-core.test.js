// jaelyo notes prefill core tests — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthsBackCutoff,
  datesInRange,
  aggregateTopCodes,
  prefillNotes,
  applyNotesToBoard,
  structuredEqual,
  buildDefaultNoteForRow,
  ensureNotesForRows,
  fillMissingNotes,
} from './jaelyo-notes-core.js';

test('notes prefill: 최근 4개월 + 날짜별 top100 + code 중복 제거', () => {
  assert.equal(monthsBackCutoff('2026-07-03', 4), '2026-03-03');
  const dates = datesInRange(['2026-02-28', '2026-03-03', '2026-06-11', '2026-07-03'], '2026-03-03', '2026-07-03');
  assert.deepEqual(dates, ['2026-03-03', '2026-06-11', '2026-07-03']);
  const rows101 = Array.from({ length: 101 }, (_, i) => ({ code: `C${i + 1}`, name: `종목${i + 1}`, rank: i + 1 }));
  const agg = aggregateTopCodes([
    { rows: [{ code: 'A', name: '에이', rank: 1 }, { code: 'B', name: '비', rank: 2 }] },
    { rows: [{ code: 'A', name: '에이', rank: 3 }, ...rows101] },
  ], 100);
  assert.equal(agg.find((x) => x.code === 'A').appearances, 2);
  assert.ok(agg.some((x) => x.code === 'C98'), '상위 100 안 종목 포함');
  assert.ok(!agg.some((x) => x.code === 'C101'), 'top100 초과 종목 제외');
});

test('prefillNotes: notes 빈 경우만 채우고 기존 notes는 덮어쓰지 않음', () => {
  assert.deepEqual(prefillNotes({ notes: '' }, '새 메모'), {
    manual: {
      newOrExisting: '', theme: '', material: '', materialPersistence: '',
      materialContinuity: '', financials: '', supplyDemand: '', notes: '새 메모',
    },
    filled: true,
  });
  const existing = prefillNotes({ notes: '기존 메모' }, '새 메모');
  assert.equal(existing.manual.notes, '기존 메모');
  assert.equal(existing.filled, false);
});

test('applyNotesToBoard: 구조화 manual 필드는 변경하지 않고 notes만 채움', () => {
  const board = { rows: [
    { code: 'A', name: '에이', manual: { theme: '사용자테마', material: '사용자재료', supplyDemand: '사용자수급', notes: '' } },
    { code: 'B', name: '비', manual: { theme: '기존', notes: '기존 notes' } },
    { code: 'C', name: '씨', manual: { theme: '유지' } },
  ] };
  const before = JSON.parse(JSON.stringify(board));
  const { board: out, filledCount, rowsTouched } = applyNotesToBoard(board, { A: 'A notes', B: 'B new', Z: 'ignored' });
  assert.equal(filledCount, 1);
  assert.equal(rowsTouched, 1);
  assert.equal(out.rows[0].manual.notes, 'A notes');
  assert.equal(out.rows[1].manual.notes, '기존 notes');
  assert.equal(out.rows[2].manual.notes, undefined);
  assert.equal(out.rows[0].manual.theme, '사용자테마');
  assert.equal(out.rows[0].manual.material, '사용자재료');
  assert.equal(out.rows[0].manual.supplyDemand, '사용자수급');
  assert.ok(structuredEqual(before.rows[0].manual, out.rows[0].manual));
  assert.ok(structuredEqual(before.rows[1].manual, out.rows[1].manual));
});

test('applyNotesToBoard: seed가 없는 code는 manual 객체 자체를 유지', () => {
  const manual = { theme: '테마', notes: '' };
  const board = { rows: [{ code: 'X', manual }] };
  const { board: out, filledCount } = applyNotesToBoard(board, { A: 'notes' });
  assert.equal(filledCount, 0);
  assert.equal(out.rows[0].manual, manual);
});

test('buildDefaultNoteForRow: 종목명 기반 보수적 기본 메모(5줄, 구체 재료 미단정)', () => {
  const note = buildDefaultNoteForRow({ code: '010950', name: 'S-Oil' });
  const lines = note.split('\n');
  assert.equal(lines.length, 5);
  assert.equal(lines[0], '(테마) 확인 필요');
  assert.equal(lines[1], '재료: S-Oil — 재료정리 거래대금 상위권 편입, 구체 재료 확인 필요');
  assert.equal(lines[2], '세계: 확인 필요');
  assert.equal(lines[3], '국내: 거래대금 상위권 편입, 수급·뉴스 확인 필요');
  assert.equal(lines[4], '체크: 재료 지속성, 실적/재무, 공시·뉴스 원문, 수급 연속성 확인 필요');
});

test('buildDefaultNoteForRow: 종목명 없으면 code 사용', () => {
  assert.match(buildDefaultNoteForRow({ code: '399720', name: '' }), /재료: 399720 —/);
  assert.match(buildDefaultNoteForRow({ code: '399720' }), /재료: 399720 —/);
});

test('ensureNotesForRows: seed 있으면 우선, 없으면 기본 메모, code 없으면 제외', () => {
  const rows = [
    { code: 'A', name: '에이' },
    { code: 'B', name: '비' },
    { code: '', name: '무코드' },
  ];
  const map = ensureNotesForRows(rows, { A: '시드 메모', B: '   ' });
  assert.equal(map.A, '시드 메모'); // seed non-empty 우선
  assert.match(map.B, /재료: 비 —/); // seed 공백 → 기본 메모
  assert.ok(!('' in map)); // code 없는 행 제외
});

test('fillMissingNotes: 빈 notes만 기본 메모로 채우고 기존 notes/구조화는 불변', () => {
  const kept = { theme: '테마유지', notes: '기존 메모' };
  const rows = [
    { code: 'A', name: '에이', manual: { theme: '사용자테마', notes: '' } },
    { code: 'B', name: '비', manual: kept },
    { code: 'C', name: '씨' },
  ];
  const { rows: out, generated } = fillMissingNotes(rows);
  // A: 빈 notes → 기본 메모 채움, 구조화 유지
  assert.match(out[0].manual.notes, /재료: 에이 —/);
  assert.equal(out[0].manual.theme, '사용자테마');
  // B: 기존 notes 불변 → 원본 객체 그대로 반환
  assert.equal(out[1], rows[1]);
  assert.equal(out[1].manual, kept);
  // C: manual 없음 → 기본 메모 생성
  assert.match(out[2].manual.notes, /재료: 씨 —/);
  // generated: 새로 채운 code만
  assert.deepEqual(Object.keys(generated).sort(), ['A', 'C']);
  assert.match(generated.A, /재료: 에이 —/);
});
