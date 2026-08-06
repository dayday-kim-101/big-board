// GET /api/korea-market?email=              → { dates, latest, report }  (날짜 드롭다운 + 최근 20시 이후 스냅샷)
// GET /api/korea-market?email=&date=YYYY-MM-DD → 해당일 리포트 + 사용자 한줄메모
// PUT /api/korea-market?email=&date=YYYY-MM-DD body:{ memo }
import { emailKey, normalizeEmail, readJson, writeJson, listDir } from './_github.js';
import { applyMemo, sanitizeReport } from './_korea-market-core.js';

const REPORT_DIR = 'data/korea-market';
const NOTE_DIR = 'data/korea-market-notes';
const notePath = (hash) => `${NOTE_DIR}/${hash}.json`;
const reportPath = (date) => `${REPORT_DIR}/${date}.json`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
const REPORT_HEADERS = { ...JSON_HEADERS, 'Cache-Control': 'public, max-age=60' };

function envReady(env) { return Boolean(env && env.GITHUB_TOKEN && env.GITHUB_REPO); }
function err(message, status = 400) { return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS }); }
function emptyNotes() { return { updatedAt: null, notes: {} }; }
export function isValidDate(s) { return typeof s === 'string' && DATE_RE.test(s); }
export function parseDirDates(items) {
  return (Array.isArray(items) ? items : [])
    .map((e) => e?.name || '')
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.slice(0, -5))
    .filter(isValidDate)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

export async function onRequestGet({ request, env }) {
  if (!envReady(env)) return err('서버 환경변수(GITHUB_*) 미설정', 500);
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  const requestedDate = url.searchParams.get('date');
  if (!normalizeEmail(email)) return err('email 파라미터 필요');
  if (requestedDate && !isValidDate(requestedDate)) return err('date 형식은 YYYY-MM-DD');
  try {
    const [hash, dates] = await Promise.all([emailKey(email), listDir(env, REPORT_DIR).then(parseDirDates)]);
    const date = requestedDate || dates[0] || null;
    if (!date) return new Response(JSON.stringify({ dates: [], latest: null, report: null, updatedAt: null }), { headers: JSON_HEADERS });
    const [{ data: reportData }, { data: notesData }] = await Promise.all([readJson(env, reportPath(date)), readJson(env, notePath(hash))]);
    const notes = notesData || emptyNotes();
    const base = reportData ? sanitizeReport(reportData) : sanitizeReport({ date });
    const memo = String(notes.notes?.[date] ?? '');
    return new Response(JSON.stringify({ dates, latest: dates[0] ?? null, report: applyMemo(base, memo), updatedAt: notes.updatedAt ?? null }), { headers: requestedDate ? REPORT_HEADERS : JSON_HEADERS });
  } catch (e) {
    return err(`국내증시 리포트 로드 실패: ${e.message}`, 502);
  }
}

export async function onRequestPut({ request, env }) {
  if (!envReady(env)) return err('서버 환경변수(GITHUB_*) 미설정', 500);
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  const date = url.searchParams.get('date');
  if (!normalizeEmail(email)) return err('email 파라미터 필요');
  if (!DATE_RE.test(date || '')) return err('date 형식은 YYYY-MM-DD');
  let body;
  try { body = await request.json(); } catch { return err('잘못된 JSON 본문'); }
  const memo = String(body?.memo ?? '').slice(0, 1000);
  try {
    const hash = await emailKey(email);
    const { data } = await readJson(env, notePath(hash));
    const current = data || emptyNotes();
    const saved = { updatedAt: new Date().toISOString(), notes: { ...(current.notes || {}), [date]: memo } };
    await writeJson(env, notePath(hash), saved, `chore: 국내증시 ${date} 한줄메모 갱신`);
    const report = sanitizeReport({ date, memo });
    return new Response(JSON.stringify({ report, updatedAt: saved.updatedAt }), { headers: JSON_HEADERS });
  } catch (e) {
    return err(`국내증시 메모 저장 실패: ${e.message}`, 502);
  }
}

export function onRequestOptions() {
  return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
}
