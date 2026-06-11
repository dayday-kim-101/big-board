// GET  /api/jaelyo                 → { dates: [...desc], latest }  (날짜 드롭다운용)
// GET  /api/jaelyo?date=YYYY-MM-DD  → 해당일 보드 { date, rows: [...] } (없으면 빈 보드)
// PUT  /api/jaelyo?date=YYYY-MM-DD  body: { code, manual }  → 수동필드 부분 병합 저장
//
// 데이터는 data/jaelyo/<date>.json (public/ 밖). Function이 GitHub에서 직접 read/write.
import { readJson, writeJson, listDir } from './_github.js';
import { sanitizeManual, normalizeBoard } from './_jaelyo-core.js';

const DIR = 'data/jaelyo';
const filePath = (date) => `${DIR}/${date}.json`;

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
    const { data } = await readJson(env, filePath(date));
    return new Response(JSON.stringify(data || emptyBoard(date)), { headers: BOARD_HEADERS });
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
  const code = String(body?.code ?? '').trim();
  if (!code) return err('code 필요');
  if (!body?.manual || typeof body.manual !== 'object') return err('manual 객체 필요');

  try {
    const { data } = await readJson(env, filePath(date));
    if (!data) return err('해당 날짜 보드가 없습니다(아직 수집 전)', 404);
    let next;
    try {
      next = applyManualPatch(data, code, body.manual);
    } catch (e) {
      return err(e.message, 404);
    }
    const saved = normalizeBoard(next);
    await writeJson(env, filePath(date), saved, `chore: 재료정리 ${date} ${code} 수동입력 갱신`);
    return new Response(JSON.stringify(saved), { headers: JSON_HEADERS });
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
