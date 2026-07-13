// GET /api/list?email=foo@bar.com   → 사용자 종목·그룹
// PUT /api/list?email=foo@bar.com   body: { groups: [...] }  → 저장(동기화)
import { emailKey, userPath, readJson, writeJson, normalizeEmail } from './_github.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

const MARKETS = new Set(['KR', 'US']);

export function emptyList() {
  return { groups: [], updatedAt: null };
}

// 입력 정제·검증. 잘못된 구조면 throw. 알 수 없는 필드는 버린다.
export function normalizeList(input) {
  if (!input || typeof input !== 'object') throw new Error('본문이 객체가 아님');
  const groupsIn = input.groups;
  if (!Array.isArray(groupsIn)) throw new Error('groups 배열이 필요함');

  const groups = groupsIn.map((g, gi) => {
    if (!g || typeof g !== 'object') throw new Error(`그룹[${gi}]가 객체가 아님`);
    const name = String(g.name ?? '').trim();
    if (!name) throw new Error(`그룹[${gi}] 이름 누락`);
    const market = MARKETS.has(g.market) ? g.market : null; // 그룹 시장은 선택(혼합 허용)
    const tickersIn = Array.isArray(g.tickers) ? g.tickers : [];
    const seen = new Set();
    const tickers = [];
    for (const t of tickersIn) {
      if (!t || typeof t !== 'object') continue;
      // memo row: 종목 사이 구분/메모 한 줄. 빈 text도 보존. 알 수 없는 type은 버린다.
      if (t.type !== undefined) {
        if (t.type !== 'memo') continue;
        const id = String(t.id ?? '').trim() || `m${gi}-${tickers.length}`;
        tickers.push({ type: 'memo', id, text: typeof t.text === 'string' ? t.text : '' });
        continue;
      }
      const tMarket = MARKETS.has(t.market) ? t.market : null;
      const code = String(t.code ?? '').trim();
      if (!tMarket || !code) throw new Error(`그룹[${gi}] 종목의 market/code 오류`);
      const dedupe = `${tMarket}:${code}`;
      if (seen.has(dedupe)) continue; // 중복 종목 제거
      seen.add(dedupe);
      tickers.push({ market: tMarket, code, name: String(t.name ?? code).trim() || code });
    }
    return {
      id: String(g.id ?? `g${gi}`),
      name,
      ...(market ? { market } : {}),
      tickers,
    };
  });

  return { groups, updatedAt: new Date().toISOString() };
}

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
    const { data } = await readJson(env, userPath(hash));
    return new Response(JSON.stringify(data || emptyList()), { headers: JSON_HEADERS });
  } catch (e) {
    return err(`목록 읽기 실패: ${e.message}`, 502);
  }
}

export async function onRequestPut({ request, env }) {
  if (!envReady(env)) return err('서버 환경변수(GITHUB_*) 미설정', 500);
  const email = new URL(request.url).searchParams.get('email');
  if (!normalizeEmail(email)) return err('email 파라미터 필요');

  let body;
  try {
    body = await request.json();
  } catch {
    return err('잘못된 JSON 본문');
  }

  let list;
  try {
    list = normalizeList(body);
  } catch (e) {
    return err(`유효성 오류: ${e.message}`, 422);
  }

  try {
    const hash = await emailKey(email);
    await writeJson(env, userPath(hash), list, `chore: ${normalizeEmail(email)} 종목 목록 업데이트`);
    return new Response(JSON.stringify(list), { headers: JSON_HEADERS });
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
