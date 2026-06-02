// GET /api/search?q=삼성  또는  ?q=AAPL
// → { results: [{market, code, name, sub}] }  (KR=네이버, US=Yahoo)
// 토큰 불필요(공개 검색 API 프록시). 자동완성 + 유효 종목만 추가하기 위한 소스.
import { searchTickers } from './_search-core.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=30',
};

export async function onRequestGet({ request }) {
  const q = new URL(request.url).searchParams.get('q') || '';
  try {
    const results = await searchTickers(q, 8);
    return new Response(JSON.stringify({ results }), { headers: JSON_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ results: [], error: e.message }), {
      status: 502,
      headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' },
    });
  }
}

export function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
