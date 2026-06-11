// 일별 재료정리 수집 — GitHub Action에서 장 마감 후 1회 실행.
// KRX(data.krx.co.kr) 전종목 시세에서 거래대금 상위 100을 골라 시총대비 비율·전일순위·
// manual 병합 후 data/jaelyo/<KST-오늘>.json 에 기록한다. 커밋/푸시는 워크플로가 담당.
//
// 인증·환경변수 불필요(KRX 공개 데이터).
// 백필: JAELYO_BACKFILL_FROM=YYYY-MM-DD 를 주면 그 날짜~오늘까지 일별 수집(휴장일은 자동 스킵).
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  fetchAllStocks,
  rankByTradingValue,
  buildRankMap,
  attachPrevRank,
  mergeManual,
  normalizeBoard,
} from '../functions/api/_jaelyo-core.js';

const OUT_DIR = process.env.JAELYO_DIR || 'data/jaelyo';
const TOP_N = Number(process.env.JAELYO_TOP_N || 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// from~to(YYYY-MM-DD) 사이 모든 달력일 오름차순. (백필 — 휴장일은 수집 단계에서 스킵)
export function enumerateDates(from, to) {
  if (!from || !to || from > to) return [];
  const out = [];
  const end = new Date(`${to}T00:00:00Z`).getTime();
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
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

// 하루치 수집·기록. 휴장(빈 응답)이면 파일 미작성하고 false 반환.
async function collectDay(dir, date) {
  const ranked = rankByTradingValue(await fetchAllStocks(date), TOP_N);
  if (!ranked.length) {
    console.log(`수집 결과 없음(휴장 추정) — ${date} 파일 미작성`);
    return false;
  }

  // 전일순위(직전 개장일 파일) + manual 보존(오늘 파일 재실행 대비)을 병렬로 읽는다.
  const dates = await listDates(dir);
  const prevDate = pickPrevDate(dates, date);
  const [prevBoard, existing] = await Promise.all([readBoard(dir, prevDate), readBoard(dir, date)]);
  let rows = attachPrevRank(ranked, buildRankMap(prevBoard?.rows));
  rows = mergeManual(rows, existing?.rows);

  const board = normalizeBoard({ date, collectedAt: new Date().toISOString(), source: 'krx', rows });
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${date}.json`), JSON.stringify(board, null, 2) + '\n');
  console.log(`재료정리 기록: ${board.rows.length}종목 → ${date}.json (전일=${prevDate ?? '없음'})`);
  return true;
}

// --- 메인 ---

async function main() {
  const today = kstDateString();
  const from = process.env.JAELYO_BACKFILL_FROM;
  const dates = from ? enumerateDates(from, today) : [today];
  if (!dates.length) throw new Error(`수집 대상 날짜 없음(JAELYO_BACKFILL_FROM=${from})`);

  for (const d of dates) {
    try {
      await collectDay(OUT_DIR, d);
    } catch (e) {
      console.warn(`${d} 수집 실패: ${e.message}`);
    }
    if (dates.length > 1) await sleep(800); // 백필 시 KRX에 과부하 주지 않도록 간격
  }
}

// 직접 실행될 때만 main() (테스트 import 시에는 실행 안 함)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
