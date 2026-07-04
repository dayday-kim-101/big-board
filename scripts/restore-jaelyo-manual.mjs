// 재료정리 수동입력 복구 실행기 — 기준 커밋(old ref)의 manual 구조화 필드를 정본으로 되돌린다.
//
// 배경: PR #19(seed prefill)가 빈 구조화 필드를 자동 seed로 채웠다. 사용자는 seed를 자신의
//       작성값으로 보지 않으므로, #19 이전 커밋(기본 f8fdd2b)의 구조화 필드로 복원한다.
//       사용자가 실제로 작성했던 값은 복구되고, seed로 채워진 값은 다시 비워진다.
//       팝업 자유 메모(notes)는 old엔 없던 새 값이므로 current 값을 보존한다.
//
// 동작:
//   1) data/jaelyo/*.json 날짜 파일 목록을 읽는다.
//   2) 각 파일마다 `git show <old-ref>:<path>`로 기준 시점 보드를 읽는다(없으면 빈 보드로 취급).
//   3) restoreBoard로 code 기준 대조 → 구조화 필드 복원/초기화, notes 보존.
//   4) 변경분을 다시 쓰고(옵션 --dry-run이면 미기록), 요약을 콘솔·_restore-summary.json에 남긴다.
//
// 옵션:
//   --old-ref=<ref>   기준 커밋(기본 f8fdd2b)
//   --data-dir=<dir>  데이터 디렉터리(기본 data/jaelyo)
//   --dry-run         파일 미기록, 요약만 출력
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { normalizeBoard } from '../functions/api/_jaelyo-core.js';
import { restoreBoard } from './restore-jaelyo-manual-core.js';

function parseArgs(argv) {
  const get = (name, def) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : def;
  };
  return {
    oldRef: get('old-ref', 'f8fdd2b'),
    dataDir: get('data-dir', 'data/jaelyo'),
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

// git show <ref>:<path> → 파싱된 JSON. 해당 ref에 파일이 없으면 null.
function gitShowJson(ref, filePath) {
  try {
    const out = execFileSync('git', ['show', `${ref}:${filePath}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(out);
  } catch {
    return null; // ref에 없던 파일(신규 수집일 등) → 기준값 없음
  }
}

async function main() {
  const { oldRef, dataDir, dryRun, summaryPath } = parseArgs(process.argv.slice(2));
  const dates = await listDates(dataDir);
  if (!dates.length) {
    console.log('보드 없음 — 종료');
    return;
  }

  let totalRestored = 0;
  let totalReset = 0;
  let totalRowsTouched = 0;
  let rowCount = 0;
  let filesChanged = 0;
  const perDate = [];

  for (const d of dates) {
    const filePath = path.join(dataDir, `${d}.json`);
    const current = JSON.parse(await readFile(filePath, 'utf8'));
    const old = gitShowJson(oldRef, filePath); // null이면 restoreBoard가 모든 구조화 필드 초기화
    const { board, restoredCount, resetCount, rowsTouched } = restoreBoard(old, current);
    totalRestored += restoredCount;
    totalReset += resetCount;
    totalRowsTouched += rowsTouched;
    rowCount += Array.isArray(current.rows) ? current.rows.length : 0;

    perDate.push({ date: d, restored: restoredCount, reset: resetCount, rowsTouched, oldMissing: old === null });

    if (restoredCount > 0 || resetCount > 0) {
      filesChanged += 1;
      if (!dryRun) {
        const saved = normalizeBoard(board);
        await writeFile(filePath, JSON.stringify(saved, null, 2) + '\n');
      }
    }
  }

  const summary = {
    oldRef,
    dataDir,
    dryRun,
    dateCount: dates.length,
    rowCount, //               전체 처리 행 수(파일별 rows 합)
    filesChanged,
    totalRowsTouched,
    totalFieldsRestored: totalRestored, // 사용자 작성값 복원
    totalFieldsReset: totalReset, //        seed 자동값 초기화
    perDate,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!dryRun && summaryPath) {
    await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
