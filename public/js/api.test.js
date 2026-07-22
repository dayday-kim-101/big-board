import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSnapshot, getQuotes } from './api.js';

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push(String(url));
    return handler(String(url), opts, calls);
  };
  return calls;
}
const res = (ok, body) => ({ ok, json: async () => body });

test('getSnapshot: /api/snapshot 성공 시 그대로 사용 (정적 미호출)', async () => {
  const snap = { updatedAt: '2026-06-02T00:00:00Z', quotes: { 'KR:005930': { price: 1 } } };
  const calls = stubFetch((url) => {
    if (url === '/api/snapshot') return res(true, snap);
    return res(true, { updatedAt: null, quotes: {} });
  });
  const out = await getSnapshot();
  assert.deepEqual(out, snap);
  assert.deepEqual(calls, ['/api/snapshot'], '정적 파일은 호출하지 않음');
});

test('getSnapshot: Function 비-200 → 정적 파일로 폴백', async () => {
  const staticSnap = { updatedAt: '2026-06-01T00:00:00Z', quotes: {} };
  const calls = stubFetch((url) => {
    if (url === '/api/snapshot') return res(false, { error: 'x' });
    if (url.startsWith('/data/prices/latest.json')) return res(true, staticSnap);
    return res(false, {});
  });
  const out = await getSnapshot();
  assert.deepEqual(out, staticSnap);
  assert.equal(calls.length, 2, 'Function 후 정적 폴백');
  assert.ok(calls[1].startsWith('/data/prices/latest.json'));
});

test('getSnapshot: Function 예외 → 정적 폴백', async () => {
  const staticSnap = { updatedAt: null, quotes: { 'US:AAPL': { price: 2 } } };
  stubFetch((url) => {
    if (url === '/api/snapshot') throw new Error('network');
    return res(true, staticSnap);
  });
  const out = await getSnapshot();
  assert.deepEqual(out, staticSnap);
});

test('getSnapshot: 둘 다 실패 → 빈 스냅샷', async () => {
  stubFetch(() => res(false, {}));
  const out = await getSnapshot();
  assert.deepEqual(out, { updatedAt: null, quotes: {} });
});

test('getQuotes: 40개 초과 시 배치 분할 — 90개 → 3회 요청(40/40/10), 병합 반환', async () => {
  const bodies = [];
  stubFetch((url, opts) => {
    const { items } = JSON.parse(opts.body);
    bodies.push(items.length);
    const quotes = {};
    for (const it of items) quotes[`${it.market}:${it.code}`] = { code: it.code, ok: true };
    return res(true, { updatedAt: `2026-07-22T00:0${bodies.length}:00Z`, quotes });
  });
  const items = Array.from({ length: 90 }, (_, i) => ({ market: 'KR', code: String(i).padStart(6, '0') }));
  const out = await getQuotes(items);
  assert.deepEqual(bodies, [40, 40, 10]);
  assert.equal(Object.keys(out.quotes).length, 90);
  assert.equal(out.updatedAt, '2026-07-22T00:03:00Z', '가장 최신 updatedAt 사용');
});

test('getQuotes: 일부 배치 실패 → 성공분만 병합, 전부 실패 → throw', async () => {
  let call = 0;
  stubFetch((url, opts) => {
    call += 1;
    if (call === 2) return res(false, { error: 'x' }); // 두 번째 배치만 실패
    const { items } = JSON.parse(opts.body);
    const quotes = {};
    for (const it of items) quotes[`${it.market}:${it.code}`] = { code: it.code, ok: true };
    return res(true, { updatedAt: '2026-07-22T00:00:00Z', quotes });
  });
  const items = Array.from({ length: 90 }, (_, i) => ({ market: 'KR', code: String(i).padStart(6, '0') }));
  const out = await getQuotes(items);
  assert.equal(Object.keys(out.quotes).length, 50, '실패한 40개 제외한 50개(40+10)');

  stubFetch(() => res(false, { error: 'down' }));
  await assert.rejects(() => getQuotes([{ market: 'KR', code: '005930' }]), /시세 로드 실패/);
});

test('getQuotes: 빈 목록 → 요청 없이 빈 결과', async () => {
  const calls = stubFetch(() => res(true, { updatedAt: 'x', quotes: {} }));
  const out = await getQuotes([]);
  assert.deepEqual(out, { updatedAt: null, quotes: {} });
  assert.equal(calls.length, 0);
});
