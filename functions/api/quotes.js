// GET  /api/quotes?codes=KR:005930,US:AAPL
// POST /api/quotes   body: { items: [{market, code}, ...] }
// → { updatedAt, quotes: { "KR:005930": {정규화}, ... } }
import { fetchQuotes } from './_quotes-core.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  // 같은 도메인(Pages)에서 호출되지만 폭넓은 접근을 위해 허용
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

function parseCodes(param) {
  // "KR:005930,US:AAPL" → [{market, code}]
  return String(param || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tok) => {
      const [market, code] = tok.split(':');
      return { market, code };
    })
    .filter((it) => it.code);
}

function key(q) {
  return `${q.market}:${q.code}`;
}

async function respond(items) {
  const results = await fetchQuotes(items);
  const quotes = {};
  for (const q of results) quotes[key(q)] = q;
  return new Response(
    JSON.stringify({ updatedAt: new Date().toISOString(), quotes }),
    { headers: JSON_HEADERS }
  );
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const items = parseCodes(url.searchParams.get('codes'));
  return respond(items);
}

export async function onRequestPost({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: '잘못된 JSON 본문' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }
  const items = Array.isArray(body?.items) ? body.items : [];
  return respond(items);
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
