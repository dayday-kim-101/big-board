// 종목코드 팝업 자유 메모(notes) 선작성 실행기 — 최근 N개월 보드의 '빈' notes 만 채운다.
//
// 동작:
//   1) data/jaelyo/*.json 날짜 목록에서 최신일 기준 N개월(기본 4) 구간을 고른다.
//   2) 구간 보드들의 거래대금 상위 TOP_N 을 code 기준 합집합·중복제거(대상 종목 산출).
//   3) data/jaelyo/notes-seed.json(code→notes 문자열)을 각 구간 보드 행의 '빈' notes 에만 채운다.
//      → 이미 작성된 notes·구조화 7필드는 절대 건드리지 않는다.
//   4) 변경된 일자 파일을 다시 쓰고, 요약을 data/jaelyo/_notes-prefill-summary.json 에 남긴다.
//
// 멱등: 다시 실행해도 이미 채워진 notes 는 건드리지 않아 결과가 안정적이다.
// 옵션: --dry-run(파일 미기록, 요약만 콘솔 출력).
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeBoard } from '../functions/api/_jaelyo-core.js';
import { monthsBackCutoff, datesInRange, aggregateTopCodes, applyNotesToBoard } from './jaelyo-notes-core.js';

const DIR = process.env.JAELYO_DIR || 'data/jaelyo';
const SEED_PATH = process.env.JAELYO_NOTES_SEED_PATH || path.join(DIR, 'notes-seed.json');
const SUMMARY_PATH = path.join(DIR, '_notes-prefill-summary.json');
const MONTHS = Number(process.env.JAELYO_MONTHS || 4);
const TOP_N = Number(process.env.JAELYO_TOP_N || 100);
const DRY_RUN = process.argv.includes('--dry-run');

async function listDates(dir) {
  return (await readdir(dir))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, -5))
    .sort();
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function main() {
  const seed = await readJson(SEED_PATH);
  const allDates = await listDates(DIR);
  if (!allDates.length) {
    console.log('보드 없음 — 종료');
    return;
  }
  const latest = allDates[allDates.length - 1];
  const cutoff = monthsBackCutoff(latest, MONTHS);
  const dates = datesInRange(allDates, cutoff, latest);

  const boards = [];
  for (const d of dates) boards.push(await readJson(path.join(DIR, `${d}.json`)));

  const codes = aggregateTopCodes(boards, TOP_N);
  const targetNotes = Object.fromEntries(codes.filter((c) => seed[c.code]).map((c) => [c.code, seed[c.code]]));
  const seededCodes = Object.keys(targetNotes).length;

  let totalNotesFilled = 0;
  let filesChanged = 0;
  for (let i = 0; i < dates.length; i++) {
    const { board, filledCount } = applyNotesToBoard(boards[i], targetNotes);
    totalNotesFilled += filledCount;
    if (filledCount > 0) {
      filesChanged += 1;
      if (!DRY_RUN) {
        const saved = normalizeBoard(board);
        await writeFile(path.join(DIR, `${dates[i]}.json`), JSON.stringify(saved, null, 2) + '\n');
      }
    }
  }

  const summary = {
    generatedFrom: latest,
    months: MONTHS,
    cutoff,
    dateRange: dates.length ? [dates[0], dates[dates.length - 1]] : [],
    dateCount: dates.length,
    topN: TOP_N,
    uniqueCodeCount: codes.length,
    seedCodeCount: Object.keys(seed).length,
    matchedCodeCount: seededCodes, //     대상 종목 중 seed 보유
    unmatchedCodeCount: codes.length - seededCodes, // seed 없는 대상 종목
    totalNotesFilled, //                  빈 notes 를 채운 행(=필드) 수
    filesChanged,
    dryRun: DRY_RUN,
  };
  if (!DRY_RUN) await writeFile(SUMMARY_PATH, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
