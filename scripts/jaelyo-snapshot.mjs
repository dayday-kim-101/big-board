// 일별 재료정리 수집 — GitHub Action에서 장 마감 후 1회 실행.
// 키움 REST API에서 거래대금 상위 100을 받아 시총 보강·비율·전일순위·manual 병합 후
// data/jaelyo/<KST-오늘>.json 에 기록한다. 커밋/푸시는 워크플로가 담당.
//
// 필요한 환경변수: KIWOOM_APPKEY, KIWOOM_SECRETKEY (+ 선택 KIWOOM_API_BASE)
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  issueToken,
  fetchTopTradingValue,
  enrichMarketCaps,
  buildRankMap,
  attachPrevRank,
  mergeManual,
  normalizeBoard,
} from '../functions/api/_jaelyo-core.js';

const OUT_DIR = process.env.JAELYO_DIR || 'data/jaelyo';
const TOP_N = Number(process.env.JAELYO_TOP_N || 100);

// --- 순수 헬퍼 (테스트 대상) ---

// UTC 시각 → KST(+9) 날짜 문자열 YYYY-MM-DD.
export function kstDateString(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// 날짜 목록에서 today 미만 최신 1개. 없으면 null.
export function pickPrevDate(dates, today) {
  const prior = (dates ?? []).filter((d) => d < today).sort();
  return prior.length ? prior[prior.length - 1] : null;
}

// --- 파일 IO ---

async function listDates(dir) {
  try {
    return (await readdir(dir))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

async function readBoard(dir, date) {
  if (!date) return null;
  try {
    return JSON.parse(await readFile(path.join(dir, `${date}.json`), 'utf8'));
  } catch {
    return null;
  }
}

// --- 메인 ---

async function main() {
  const env = process.env;
  if (!env.KIWOOM_APPKEY || !env.KIWOOM_SECRETKEY) {
    throw new Error('환경변수 KIWOOM_APPKEY/KIWOOM_SECRETKEY 미설정');
  }

  const today = kstDateString();
  const token = await issueToken(env);

  let rows = await fetchTopTradingValue(env, token, { limit: TOP_N });
  // 휴장/빈 응답 가드: 데이터가 없으면 파일을 쓰지 않고 정상 종료.
  if (!rows.length) {
    console.log(`수집 결과 없음(휴장 추정) — ${today} 파일 미작성`);
    return;
  }

  rows = await enrichMarketCaps(env, token, rows);

  // 전일순위: 직전 개장일 파일에서 (code→rank) 맵.
  // manual 보존: 오늘 파일이 이미 있으면(재실행) 기존 수동입력 병합.
  // 두 파일 읽기는 서로 독립적이므로 병렬로 읽는다.
  const dates = await listDates(OUT_DIR);
  const prevDate = pickPrevDate(dates, today);
  const [prevBoard, existingToday] = await Promise.all([
    readBoard(OUT_DIR, prevDate),
    readBoard(OUT_DIR, today),
  ]);
  rows = attachPrevRank(rows, buildRankMap(prevBoard?.rows));
  rows = mergeManual(rows, existingToday?.rows);

  const board = normalizeBoard({
    date: today,
    collectedAt: new Date().toISOString(),
    source: 'kiwoom',
    rows,
  });

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${today}.json`);
  await writeFile(outPath, JSON.stringify(board, null, 2) + '\n');
  console.log(`재료정리 기록: ${board.rows.length}종목 → ${outPath} (전일=${prevDate ?? '없음'})`);
}

// 직접 실행될 때만 main() (테스트 import 시에는 실행 안 함)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
