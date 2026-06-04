// GET /api/history?market=KR&code=005930&range=6mo
// → { candles: [{time, open, high, low, close, volume}] }
// 인터랙티브 차트(lightweight-charts)용 과거 OHLC. KR=네이버, US=Yahoo. 토큰 불필요.
import { fetchHistory } from './_history-core.js';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=120',
};

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const market = url.searchParams.get('market') || '';
  const code = url.searchParams.get('code') || '';
  const range = url.searchParams.get('range') || '6mo';
  try {
    const candles = await fetchHistory(market, code, range);
    return new Response(JSON.stringify({ candles }), { headers: JSON_HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ candles: [], error: e.message }), {
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
