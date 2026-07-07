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
  mergeRowsWithGlobalManual,
  normalizeBoard,
} from '../functions/api/_jaelyo-core.js';

const OUT_DIR = process.env.JAELYO_DIR || 'data/jaelyo';
const TOP_N = Number(process.env.JAELYO_TOP_N || 100);
// code-level 글로벌 manual(종목별 메모 영속) — 새 거래일에도 code별 메모가 이어지게 폴백.
const MANUAL_BY_CODE_FILE = 'manual-by-code.json';

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

// 해당 거래일이 이미 수집됐는가 — 재시도 창(cron 분산)에서 중복 수집·커밋을 막는 멱등 가드.
// 행이 하나라도 있으면 수집 완료로 본다. (manual 입력은 API가 갱신하므로 이 스크립트와 무관)
export function alreadyCollected(board) {
  return Array.isArray(board?.rows) && board.rows.length > 0;
}

// 수집 대상 날짜 결정 — 파일명은 today가 아니라 네이버가 보고한 거래일(tradedDate)을 쓴다.
// 예약 실행이 KST 자정을 조금 넘겨 지연돼도(today가 하루 넘어가도) 직전 거래일 파일을 채운다.
//   - 거래일 미확인(응답 이상) → null
//   - 해당 거래일 파일에 이미 rows가 있으면 → null (휴장일 재실행·재시도 창 중복 가드)
//   - 그 외 → 그 거래일 문자열(작성 대상)
export function resolveTargetDate(tradedDate, existingBoard) {
  if (!tradedDate) return null;
  return alreadyCollected(existingBoard) ? null : tradedDate;
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

// code-level 글로벌 manual map. 파일 없으면 {} (신규 배포·최초 수집 시).
async function readGlobalManual(dir) {
  try {
    const obj = JSON.parse(await readFile(path.join(dir, MANUAL_BY_CODE_FILE), 'utf8'));
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

// --- 메인 ---

async function main() {
  const today = kstDateString();

  // 재시도 창 가드: 오늘치가 이미 있으면 네이버 호출 전에 즉시 종료(중복 커밋 방지).
  // cron을 21시대 여러 번으로 분산했어도 실제 수집은 그날 첫 성공 1회만 일어난다.
  const existingToday = await readBoard(OUT_DIR, today);
  if (alreadyCollected(existingToday)) {
    console.log(`이미 수집됨(${today}, ${existingToday.rows.length}종목) — 생략`);
    return;
  }

  const { rows: all, tradedDate } = await fetchTopStocks();
  const ranked = rankByTradingValue(all, TOP_N);
  if (!ranked.length) {
    console.log('수집 결과 없음 — 파일 미작성');
    return;
  }

  // 파일명·전일순위 기준은 today가 아니라 네이버가 보고한 거래일(tradedDate)이다.
  // 지연 실행(예약이 KST 자정을 조금 넘겨 today가 하루 넘어감)이어도 직전 거래일 파일을 채운다.
  // 이미 그 거래일 파일에 rows가 있으면(휴장일 재실행·재시도 창) 대상이 null → 미작성.
  const date = tradedDate;
  const existing = await readBoard(OUT_DIR, date);
  const target = resolveTargetDate(tradedDate, existing);
  if (!target) {
    if (!tradedDate) console.log('네이버 거래일 미확인 — 파일 미작성');
    else console.log(`이미 수집됨(거래일 ${tradedDate}, ${existing.rows.length}종목) — 생략`);
    return;
  }

  // 전일순위(직전 개장일 파일)를 읽는다. 같은 날짜 manual 보존은 위에서 읽은 existing 재사용
  // (행 없는 빈 파일일 수 있어 가드를 통과했더라도 manual 병합 입력으로는 안전).
  const dates = await listDates(OUT_DIR);
  const prevDate = pickPrevDate(dates, date);
  const prevBoard = await readBoard(OUT_DIR, prevDate);
  let rows = attachPrevRank(ranked, buildRankMap(prevBoard?.rows));
  rows = mergeManual(rows, existing?.rows);
  // 같은 날짜 manual을 우선 보존한 뒤, 남은 빈 필드는 code-level 글로벌 메모로 폴백.
  // → 새 거래일에도 같은 종목이면 예전에 입력한 메모/수동정보가 따라온다.
  const globalByCode = await readGlobalManual(OUT_DIR);
  rows = mergeRowsWithGlobalManual(rows, globalByCode);

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
