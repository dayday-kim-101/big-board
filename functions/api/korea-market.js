// GET /api/korea-market?email= → 최근 장마감 한국증시 리포트 + 사용자 한줄메모
// PUT /api/korea-market?email=&date=YYYY-MM-DD body:{ memo }
import { emailKey, normalizeEmail, readJson, writeJson } from './_github.js';
import { applyMemo, fetchKoreaMarketReport, sanitizeReport } from './_korea-market-core.js';

const DIR = 'data/korea-market-notes';
const notePath = (hash) => `${DIR}/${hash}.json`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

function envReady(env) { return Boolean(env && env.GITHUB_TOKEN && env.GITHUB_REPO); }
function err(message, status = 400) { return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS }); }
function emptyNotes() { return { updatedAt: null, notes: {} }; }

export async function onRequestGet({ request, env }) {
  if (!envReady(env)) return err('서버 환경변수(GITHUB_*) 미설정', 500);
  const email = new URL(request.url).searchParams.get('email');
  if (!normalizeEmail(email)) return err('email 파라미터 필요');
  try {
    const [hash, report] = await Promise.all([emailKey(email), fetchKoreaMarketReport()]);
    const { data } = await readJson(env, notePath(hash));
    const notes = data || emptyNotes();
    const memo = String(notes.notes?.[report.date] ?? '');
    return new Response(JSON.stringify({ report: applyMemo(report, memo), updatedAt: notes.updatedAt ?? null }), { headers: JSON_HEADERS });
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
