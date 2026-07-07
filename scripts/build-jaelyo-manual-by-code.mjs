// code-level 글로벌 manual(종목별 메모 영속) 빌더 & 복구기 — 로컬/CI에서 재사용.
//
// 배경: 재료정리 메모/수동정보는 '날짜'가 아니라 '종목'에 귀속되어야 한다. 하지만 초기에는
//       메모가 dated 파일에만 흩어져 있었고, 최신 파일(예: 2026-07-07)은 메모가 전부 비어 있었다.
//       이 스크립트는 모든 dated 보드 + seed에서 종목별 정본 manual을 모아
//       data/jaelyo/manual-by-code.json 을 만든다(최신 non-empty 우선, seed는 폴백).
//
// 동작:
//   1) data/jaelyo/*.json dated 보드 + manual-seed.json + notes-seed.json 을 읽는다.
//   2) buildGlobalManualByCodeFromBoards 로 code별 정본 manual 을 만든다.
//   3) manual-by-code.json 을 쓴다(--dry-run 이면 미기록).
//   4) --fill=DATE[,DATE...] 로 지정한 dated 파일의 '빈' manual 필드를 글로벌 폴백으로 채워
//      되돌린다(예: 비어버린 2026-07-07 복구). 사용자가 채운 값은 절대 덮지 않는다.
//
// 옵션:
//   --data-dir=<dir>  데이터 디렉터리(기본 data/jaelyo)
//   --fill=<dates>    폴백 병합할 dated 파일(쉼표 구분). 기본 없음(빌드만).
//   --dry-run         파일 미기록, 요약만 출력
//   --summary=<path>  요약 JSON 기록 경로(선택)
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildGlobalManualByCodeFromBoards,
  mergeRowsWithGlobalManual,
  normalizeBoard,
  MANUAL_FIELDS,
} from '../functions/api/_jaelyo-core.js';

const MANUAL_BY_CODE_FILE = 'manual-by-code.json';

function parseArgs(argv) {
  const get = (name, def) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
  };
  const fill = get('fill', '');
  return {
    dataDir: get('data-dir', 'data/jaelyo'),
    fillDates: fill ? fill.split(',').map((s) => s.trim()).filter(Boolean) : [],
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
  const { dataDir, fillDates, dryRun, summaryPath } = parseArgs(process.argv.slice(2));

  const dates = await listDates(dataDir);
  const boards = [];
  for (const d of dates) {
    const b = await readJsonFile(path.join(dataDir, `${d}.json`));
    if (b) boards.push(b);
  }
  const manualSeed = (await readJsonFile(path.join(dataDir, 'manual-seed.json'), {})) || {};
  const notesSeed = (await readJsonFile(path.join(dataDir, 'notes-seed.json'), {})) || {};

  const globalByCode = buildGlobalManualByCodeFromBoards(boards, { manualSeed, notesSeed });
  const codeCount = Object.keys(globalByCode).length;

  if (!dryRun) {
    await writeFile(
      path.join(dataDir, MANUAL_BY_CODE_FILE),
      JSON.stringify(globalByCode, null, 2) + '\n',
    );
  }

  // 지정 dated 파일 복구(빈 manual → 글로벌 폴백).
  const filled = [];
  for (const d of fillDates) {
    const filePath = path.join(dataDir, `${d}.json`);
    const board = await readJsonFile(filePath);
    if (!board) {
      filled.push({ date: d, error: '파일 없음' });
      continue;
    }
    const merged = normalizeBoard(mergeBoardRows(board, globalByCode));
    const notesCount = merged.rows.filter((r) => hasNotes(r.manual)).length;
    const manualCount = merged.rows.filter((r) => hasAnyManual(r.manual)).length;
    if (!dryRun) await writeFile(filePath, JSON.stringify(merged, null, 2) + '\n');
    filled.push({ date: d, rows: merged.rows.length, notesNonEmpty: notesCount, manualNonEmpty: manualCount });
  }

  const summary = { dataDir, dryRun, dateCount: dates.length, codeCount, fill: filled };
  console.log(JSON.stringify(summary, null, 2));
  if (!dryRun && summaryPath) {
    await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  }
}

// 보드 rows에 글로벌 폴백을 적용한 새 보드.
function mergeBoardRows(board, globalByCode) {
  const rows = Array.isArray(board?.rows) ? board.rows : [];
  return { ...board, rows: mergeRowsWithGlobalManual(rows, globalByCode) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
