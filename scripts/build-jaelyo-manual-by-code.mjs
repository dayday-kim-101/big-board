// code-level 글로벌 manual(종목별 메모 영속) 빌더 & 복구기 — 로컬/CI에서 재사용.
//
// 배경: 재료정리 메모/수동정보는 '날짜'가 아니라 '종목'에 귀속되어야 한다. 하지만 초기에는
//       메모가 dated 파일에만 흩어져 있었고, 최신 파일(예: 2026-07-07)은 메모가 전부 비어 있었다.
//       이 스크립트는 모든 dated 보드 + seed에서 종목별 정본 manual을 모아
//       data/jaelyo/manual-by-code.json 을 만든다(최신 non-empty 우선, seed는 폴백).
//
// 동작:
//   1) data/jaelyo/*.json dated 보드 + notes-seed.json 을 읽는다.
//   2) buildGlobalManualByCodeFromBoards 로 code별 정본 manual 을 만든다.
//   3) manual-by-code.json 을 쓴다(--dry-run 이면 미기록).
//   4) --fill=DATE[,DATE...] 로 지정한 dated 파일의 '빈' manual 필드를 글로벌 폴백으로 채워
//      되돌린다(예: 비어버린 2026-07-07 복구). 사용자가 채운 값은 절대 덮지 않는다.
//
// 옵션:
//   --data-dir=<dir>            데이터 디렉터리(기본 data/jaelyo)
//   --fill=<dates>|all         폴백 병합할 dated 파일(쉼표 구분, all=전체). 기본 없음(빌드만).
//   --generate-missing-notes   dated 보드 전체 code 중 notes가 없는 code에 보수적 기본 notes 생성.
//                              notes-seed+dated/global notes가 있으면 우선, 없을 때만 기본 notes.
//                              구조화 7필드는 건드리지 않음(notes만 채움).
//   --dry-run                  파일 미기록, 요약만 출력
//   --summary=<path>           요약 JSON 기록 경로(선택)
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildGlobalManualByCodeFromBoards,
  normalizeBoard,
  sanitizeManual,
  MANUAL_FIELDS,
} from '../functions/api/_jaelyo-core.js';
import { buildDefaultNoteForRow, applyNotesToBoard } from './jaelyo-notes-core.js';

const MANUAL_BY_CODE_FILE = 'manual-by-code.json';

function parseArgs(argv) {
  const get = (name, def) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
  };
  const fill = get('fill', '');
  const fillAll = fill === 'all';
  return {
    dataDir: get('data-dir', 'data/jaelyo'),
    fillAll,
    fillDates: fillAll || !fill ? [] : fill.split(',').map((s) => s.trim()).filter(Boolean),
    generateMissingNotes: argv.includes('--generate-missing-notes'),
    dryRun: argv.includes('--dry-run'),
    summaryPath: get('summary', null),
  };
}

async function listDates(dir) {
  return (await readdir(dir))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, -5))
    .sort();
}

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

// manual 8키 중 non-empty가 하나라도 있으면 true.
function hasAnyManual(manual) {
  return MANUAL_FIELDS.some((k) => String(manual?.[k] ?? '').trim() !== '');
}
function hasNotes(manual) {
  return String(manual?.notes ?? '').trim() !== '';
}

async function main() {
  const { dataDir, fillAll, fillDates, generateMissingNotes, dryRun, summaryPath } =
    parseArgs(process.argv.slice(2));

  const dates = await listDates(dataDir);
  const boards = [];
  for (const d of dates) {
    const b = await readJsonFile(path.join(dataDir, `${d}.json`));
    if (b) boards.push(b);
  }
  const notesSeed = (await readJsonFile(path.join(dataDir, 'notes-seed.json'), {})) || {};

  // 중요: manual-seed의 구조화 필드(theme/material/수급 등)는 자동으로 표 칸을 채우지 않는다.
  // 사용자가 수정하지 않은 종목에는 popup 자유 메모(notes)만 prefill한다.
  // 구조화 필드는 dated board에 실제로 남아 있는 사용자 수정값만 code-level 정본에 포함된다.
  const globalByCode = buildGlobalManualByCodeFromBoards(boards, { notesSeed });

  // 대표 행(날짜 오름차순 최신 name) — 기본 notes 생성용. dated 보드에 등장한 모든 code.
  const rowByCode = {};
  const sortedBoards = [...boards].sort((a, b) => String(a?.date ?? '').localeCompare(String(b?.date ?? '')));
  for (const b of sortedBoards) {
    for (const r of b?.rows ?? []) {
      const code = String(r?.code ?? '').trim();
      if (code) rowByCode[code] = r;
    }
  }

  // notes가 없는(seed·dated·global 어디에도 없는) code에만 보수적 기본 notes 생성.
  // notes만 채우고 구조화 7필드는 그대로 둔다(대량 seed 채움 금지).
  let generatedNotes = 0;
  if (generateMissingNotes) {
    for (const code of Object.keys(rowByCode)) {
      const cur = globalByCode[code];
      if (cur && String(cur.notes ?? '').trim() !== '') continue; // 기존 notes 우선 → 불변
      const note = buildDefaultNoteForRow(rowByCode[code]);
      globalByCode[code] = { ...sanitizeManual(cur), notes: note };
      generatedNotes += 1;
    }
  }
  const codeCount = Object.keys(globalByCode).length;

  if (!dryRun) {
    await writeFile(
      path.join(dataDir, MANUAL_BY_CODE_FILE),
      JSON.stringify(globalByCode, null, 2) + '\n',
    );
  }

  // dated 파일의 '빈 notes'만 code-level 글로벌 notes로 채운다. --fill=all 이면 전체 dated 파일.
  // 구조화 7필드는 절대 건드리지 않고(applyNotesToBoard), 기존 non-empty notes도 덮지 않는다.
  const notesByCode = notesMapFromGlobal(globalByCode);
  const targetFillDates = fillAll ? dates : fillDates;
  const filled = [];
  for (const d of targetFillDates) {
    const filePath = path.join(dataDir, `${d}.json`);
    const board = await readJsonFile(filePath);
    if (!board) {
      filled.push({ date: d, error: '파일 없음' });
      continue;
    }
    const { board: applied, filledCount } = applyNotesToBoard(board, notesByCode);
    const merged = normalizeBoard(applied);
    const notesCount = merged.rows.filter((r) => hasNotes(r.manual)).length;
    const manualCount = merged.rows.filter((r) => hasAnyManual(r.manual)).length;
    if (!dryRun) await writeFile(filePath, JSON.stringify(merged, null, 2) + '\n');
    filled.push({
      date: d,
      rows: merged.rows.length,
      notesFilled: filledCount,
      notesNonEmpty: notesCount,
      manualNonEmpty: manualCount,
    });
  }

  const summary = { dataDir, dryRun, dateCount: dates.length, codeCount, generatedNotes, fill: filled };
  console.log(JSON.stringify(summary, null, 2));
  if (!dryRun && summaryPath) {
    await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  }
}

// code-level 글로벌 manual에서 notes만 뽑아 code→notes 맵으로. 빈 notes는 제외.
// applyNotesToBoard가 이 맵으로 dated 보드의 '빈 notes'에만 채운다(구조화 필드 불변).
function notesMapFromGlobal(globalByCode) {
  const out = {};
  for (const code of Object.keys(globalByCode || {})) {
    const notes = String(globalByCode[code]?.notes ?? '').trim();
    if (notes !== '') out[code] = notes;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
