// GET  /api/jaelyo                 → { dates: [...desc], latest }  (날짜 드롭다운용)
// GET  /api/jaelyo?date=YYYY-MM-DD  → 해당일 보드 { date, rows: [...] } (없으면 빈 보드)
// PUT  /api/jaelyo?date=YYYY-MM-DD  body: { code, manual }  → 수동필드 부분 병합 저장
//
// 데이터는 data/jaelyo/<date>.json (public/ 밖). Function이 GitHub에서 직접 read/write.
import { readJson, writeJson, listDir } from './_github.js';
import {
  sanitizeManual,
  sanitizeDailyTheme,
  normalizeBoard,
  mergeRowsWithGlobalManual,
  updateGlobalManual,
  applyDailyThemePatch,
} from './_jaelyo-core.js';

const DIR = 'data/jaelyo';
const filePath = (date) => `${DIR}/${date}.json`;
// code-level 글로벌 manual(종목별 메모 영속). 날짜 무관하게 code로 메모를 이어준다.
const MANUAL_BY_CODE_PATH = `${DIR}/manual-by-code.json`;

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

// 특정일 보드는 그날 1회 수집 후 사실상 불변 → 짧게 캐시해 GitHub API 호출을 줄인다
// (snapshot.js와 동일 정책). 날짜 목록·PUT은 no-store 유지.
const BOARD_HEADERS = { ...JSON_HEADERS, 'Cache-Control': 'public, max-age=60' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- 순수 헬퍼 (테스트 대상) ---

export function isValidDate(s) {
  return typeof s === 'string' && DATE_RE.test(s);
}

// 디렉터리 목록 → 날짜 문자열 내림차순. *.json 중 YYYY-MM-DD 형식만.
export function parseDirDates(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((e) => e?.name || '')
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.slice(0, -5))
    .filter(isValidDate)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

// 보드의 특정 code 행에 manual 부분 병합. 없는 code면 throw.
export function applyManualPatch(board, code, manual) {
  const rows = Array.isArray(board?.rows) ? board.rows : [];
  const idx = rows.findIndex((r) => String(r.code) === String(code));
  if (idx < 0) throw new Error(`종목(${code})을 보드에서 찾을 수 없음`);
  const merged = sanitizeManual({ ...rows[idx].manual, ...manual });
  const nextRows = rows.map((r, i) => (i === idx ? { ...r, manual: merged } : r));
  return { ...board, rows: nextRows };
}

// 보드 rows의 빈 manual 필드를 code-level 글로벌 값으로 폴백 채운다(사용자 값은 보존).
export function mergeBoardWithGlobal(board, globalByCode) {
  const rows = Array.isArray(board?.rows) ? board.rows : [];
  return { ...board, rows: mergeRowsWithGlobalManual(rows, globalByCode) };
}

export function applyDailyThemeToBoard(board, dailyTheme) {
  return applyDailyThemePatch(board, sanitizeDailyTheme(dailyTheme));
}

// --- HTTP 핸들러 ---

function envReady(env) {
  return Boolean(env && env.GITHUB_TOKEN && env.GITHUB_REPO);
}
function err(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}
function emptyBoard(date) {
  return { date, collectedAt: null, source: null, rows: [] };
}

export async function onRequestGet({ request, env }) {
  if (!envReady(env)) return err('서버 환경변수(GITHUB_*) 미설정', 500);
  const date = new URL(request.url).searchParams.get('date');

  // date 없음 → 날짜 목록
  if (!date) {
    try {
      const dates = parseDirDates(await listDir(env, DIR));
      return new Response(JSON.stringify({ dates, latest: dates[0] ?? null }), { headers: JSON_HEADERS });
    } catch (e) {
      return err(`날짜 목록 읽기 실패: ${e.message}`, 502);
    }
  }

  if (!isValidDate(date)) return err('date 형식은 YYYY-MM-DD');
  try {
    const [{ data }, { data: globalByCode }] = await Promise.all([
      readJson(env, filePath(date)),
      readJson(env, MANUAL_BY_CODE_PATH), // 없으면 data:null → {} 취급
    ]);
    const board = data || emptyBoard(date);
    const merged = mergeBoardWithGlobal(board, globalByCode || {});
    return new Response(JSON.stringify(merged), { headers: BOARD_HEADERS });
  } catch (e) {
    return err(`보드 읽기 실패: ${e.message}`, 502);
  }
}

export async function onRequestPut({ request, env }) {
  if (!envReady(env)) return err('서버 환경변수(GITHUB_*) 미설정', 500);
  const date = new URL(request.url).searchParams.get('date');
  if (!isValidDate(date)) return err('date 형식은 YYYY-MM-DD');

  let body;
  try {
    body = await request.json();
  } catch {
    return err('잘못된 JSON 본문');
  }
  const isDailyThemePatch = body?.op === 'dailyTheme' || body?.dailyTheme !== undefined;
  const code = String(body?.code ?? '').trim();
  if (!isDailyThemePatch) {
    if (!code) return err('code 필요');
    if (!body?.manual || typeof body.manual !== 'object') return err('manual 객체 필요');
  }

  try {
    const [{ data }, { data: globalData }] = await Promise.all([
      readJson(env, filePath(date)),
      readJson(env, MANUAL_BY_CODE_PATH),
    ]);
    if (!data) return err('해당 날짜 보드가 없습니다(아직 수집 전)', 404);
    let next;
    if (isDailyThemePatch) {
      next = applyDailyThemeToBoard(data, body.dailyTheme ?? { text: body.text });
    } else {
      try {
        next = applyManualPatch(data, code, body.manual);
      } catch (e) {
        return err(e.message, 404);
      }
    }
    const saved = normalizeBoard(next);

    // 1) 날짜 파일 저장.
    await writeJson(
      env,
      filePath(date),
      saved,
      isDailyThemePatch ? `chore: 재료정리 ${date} 오늘의 테마 갱신` : `chore: 재료정리 ${date} ${code} 수동입력 갱신`,
    );

    if (isDailyThemePatch) {
      const merged = mergeBoardWithGlobal(saved, globalData || {});
      return new Response(JSON.stringify(merged), { headers: JSON_HEADERS });
    }

    // 2) code-level 글로벌 map에도 같은 patch 반영(종목별 메모 영속). 저장은 실패해도
    //    날짜 파일은 이미 반영됐으므로 사용자 입력이 유실되지 않도록 별도로 처리.
    const nextGlobal = updateGlobalManual(globalData || {}, code, body.manual);
    await writeJson(env, MANUAL_BY_CODE_PATH, nextGlobal, `chore: 재료정리 ${code} 종목 메모 갱신`);

    // 3) 응답은 글로벌 폴백까지 반영된 보드.
    const merged = mergeBoardWithGlobal(saved, nextGlobal);
    return new Response(JSON.stringify(merged), { headers: JSON_HEADERS });
  } catch (e) {
    return err(`저장 실패: ${e.message}`, 502);
  }
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
