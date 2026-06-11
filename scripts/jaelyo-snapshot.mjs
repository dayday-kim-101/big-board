// 일별 재료정리 수집 — GitHub Action에서 장 마감 후 1회 실행.
// 네이버 모바일 API에서 전 종목을 받아 거래대금 상위 100을 골라 시총대비 비율·전일순위·
// manual 병합 후 data/jaelyo/<거래일>.json 에 기록한다. 커밋/푸시는 워크플로가 담당.
//
// 인증·환경변수 불필요(네이버 공개 데이터). 당일 데이터만 제공되므로 과거 백필은 불가.
// 파일명 날짜는 네이버 응답의 거래일(localTradedAt)을 쓴다 → 휴장일에 실행돼도 어긋나지 않음.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  fetchTopStocks,
  rankByTradingValue,
  buildRankMap,
  attachPrevRank,
  mergeManual,
  normalizeBoard,
} from '../functions/api/_jaelyo-core.js';

const OUT_DIR = process.env.JAELYO_DIR || 'data/jaelyo';
const TOP_N = Number(process.env.JAELYO_TOP_N || 100);

// --- 순수 헬퍼 (테스트 대상) ---

// UTC 시각 → KST(+9) 날짜 문자열 YYYY-MM-DD. (거래일 미확인 시 파일명 폴백)
export function kstDateString(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// 날짜 목록에서 today 미만 최신 1개. 없으면 null.
export function pickPrevDate(dates, today) {
  const prior = (dates ?? []).filter((d) => d < today).sort();
  return prior.length ? prior[prior.length - 1] : null;
}

// 오늘이 개장일인가 — 네이버가 보고한 거래일이 오늘과 같을 때만 참.
// (공휴일/임시공휴일이면 네이버 거래일이 직전 개장일이라 거짓 → 하드코딩 달력 불필요)
export function isTradingDay(tradedDate, today) {
  return Boolean(tradedDate) && tradedDate === today;
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
  const today = kstDateString();
  const { rows: all, tradedDate } = await fetchTopStocks();
  const ranked = rankByTradingValue(all, TOP_N);
  if (!ranked.length) {
    console.log('수집 결과 없음 — 파일 미작성');
    return;
  }
  // 공휴일 가드: 네이버 거래일이 오늘이 아니면 휴장 → 미작성(주말·공휴일 공통).
  if (!isTradingDay(tradedDate, today)) {
    console.log(`휴장 추정(네이버 거래일 ${tradedDate ?? '없음'} ≠ 오늘 ${today}) — 파일 미작성`);
    return;
  }
  const date = today;

  // 전일순위(직전 개장일 파일) + manual 보존(같은 거래일 재실행 대비)을 병렬로 읽는다.
  const dates = await listDates(OUT_DIR);
  const prevDate = pickPrevDate(dates, date);
  const [prevBoard, existing] = await Promise.all([readBoard(OUT_DIR, prevDate), readBoard(OUT_DIR, date)]);
  let rows = attachPrevRank(ranked, buildRankMap(prevBoard?.rows));
  rows = mergeManual(rows, existing?.rows);

  const board = normalizeBoard({ date, collectedAt: new Date().toISOString(), source: 'naver', rows });
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, `${date}.json`), JSON.stringify(board, null, 2) + '\n');
  console.log(`재료정리 기록: ${board.rows.length}종목 → ${date}.json (전일=${prevDate ?? '없음'})`);
}

// 직접 실행될 때만 main() (테스트 import 시에는 실행 안 함)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
