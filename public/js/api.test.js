import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSnapshot } from './api.js';

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
