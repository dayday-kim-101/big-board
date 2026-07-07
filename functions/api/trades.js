// GET  /api/trades?email=          → { days, updatedAt }  (없으면 emptyTrades 모양)
// PUT  /api/trades?email=&date=YYYY-MM-DD  body: { op, ...} → op별 분기 저장
//   op:"upsert"    + records:[...]     → 해당일 mergeDayRecords
//   op:"manual"    + code + manual:{…} → 단일 record 부분 병합
//   op:"journal"   + journal:"…"       → 해당일 일지 설정
//   op:"resultTag" + resultTag:"…"     → 해당일 성공/실패 태그 설정 (""|"success"|"failure")
//
// 데이터는 data/trades/<emailhash>.json (public/ 밖).
import { emailKey, readJson, writeJson, normalizeEmail } from './_github.js';
import {
  tradesPath,
  emptyTrades,
  mergeDayRecords,
  applyRecordManual,
  sanitizeResultTag,
  normalizeTrades,
} from './_trades-core.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- 순수 헬퍼 (테스트 대상) ---

export function isValidDate(s) {
  return typeof s === 'string' && DATE_RE.test(s);
}

// --- HTTP 핸들러 ---

function envReady(env) {
  return Boolean(env && env.GITHUB_TOKEN && env.GITHUB_REPO);
}

function err(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

export async function onRequestGet({ request, env }) {
  if (!envReady(env)) return err('서버 환경변수(GITHUB_*) 미설정', 500);
  const email = new URL(request.url).searchParams.get('email');
  if (!normalizeEmail(email)) return err('email 파라미터 필요');

  try {
    const hash = await emailKey(email);
    const { data } = await readJson(env, tradesPath(hash));
    const trades = data || emptyTrades();
    return new Response(JSON.stringify({ days: trades.days, updatedAt: trades.updatedAt }), {
      headers: JSON_HEADERS,
    });
  } catch (e) {
    return err(`매매기록 읽기 실패: ${e.message}`, 502);
  }
}

export async function onRequestPut({ request, env }) {
  if (!envReady(env)) return err('서버 환경변수(GITHUB_*) 미설정', 500);
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  const date = url.searchParams.get('date');

  if (!normalizeEmail(email)) return err('email 파라미터 필요');
  if (!isValidDate(date)) return err('date 형식은 YYYY-MM-DD');

  let body;
  try {
    body = await request.json();
  } catch {
    return err('잘못된 JSON 본문');
  }

  const op = body?.op;
  if (!op) return err('op 필드 필요 (upsert|manual|journal|resultTag)', 422);

  try {
    const hash = await emailKey(email);
    const { data } = await readJson(env, tradesPath(hash));
    const current = data || emptyTrades();

    // 해당 날짜의 day 객체 (없으면 초기화)
    const existingDay = current.days[date] ?? { journal: '', resultTag: '', records: [] };

    let nextDay;

    if (op === 'upsert') {
      // records 배열 필수
      if (!Array.isArray(body.records)) return err('upsert op: records 배열 필요', 422);
      nextDay = {
        journal: existingDay.journal ?? '',
        resultTag: existingDay.resultTag ?? '',
        records: mergeDayRecords(existingDay.records, body.records),
      };
    } else if (op === 'resultTag') {
      // resultTag 필드 필수 ("" | "success" | "failure")
      if (body.resultTag === undefined) return err('resultTag op: resultTag 필드 필요', 422);
      nextDay = {
        journal: existingDay.journal ?? '',
        resultTag: sanitizeResultTag(body.resultTag),
        records: existingDay.records ?? [],
      };
    } else if (op === 'manual') {
      // code + manual 객체 필수
      const code = String(body?.code ?? '').trim();
      if (!code) return err('manual op: code 필요', 422);
      if (!body?.manual || typeof body.manual !== 'object') return err('manual op: manual 객체 필요', 422);
      // 해당 날짜나 code가 없으면 404
      if (!current.days[date]) return err('해당 날짜 데이터가 없음', 404);
      try {
        nextDay = applyRecordManual(existingDay, code, body.manual);
      } catch (e) {
        return err(e.message, 404);
      }
    } else if (op === 'journal') {
      // journal 문자열 필수
      if (body.journal === undefined) return err('journal op: journal 필드 필요', 422);
      nextDay = {
        journal: String(body.journal ?? '').slice(0, 10000),
        resultTag: existingDay.resultTag ?? '',
        records: existingDay.records ?? [],
      };
    } else {
      return err(`알 수 없는 op: ${op}`, 422);
    }

    const nextDays = { ...current.days, [date]: nextDay };
    const toSave = { ...current, days: nextDays };

    let saved;
    try {
      saved = normalizeTrades(toSave);
    } catch (e) {
      return err(`유효성 오류: ${e.message}`, 422);
    }

    saved.updatedAt = new Date().toISOString();

    await writeJson(env, tradesPath(hash), saved, `chore: 매매기록 ${date} 갱신`);
    return new Response(JSON.stringify({ days: saved.days, updatedAt: saved.updatedAt }), {
      headers: JSON_HEADERS,
    });
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
