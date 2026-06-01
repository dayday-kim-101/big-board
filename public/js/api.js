// 서버(Pages Functions) 및 정적 스냅샷 호출 래퍼.

export async function getList(email) {
  const res = await fetch(`/api/list?email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error((await safeErr(res)) || `목록 로드 실패 (${res.status})`);
  return res.json();
}

export async function putList(email, list) {
  const res = await fetch(`/api/list?email=${encodeURIComponent(email)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(list),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || `저장 실패 (${res.status})`);
  return res.json();
}

// 실시간 시세 (수동 새로고침). items: [{market, code}]
export async function getQuotes(items) {
  const res = await fetch('/api/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(`시세 로드 실패 (${res.status})`);
  return res.json(); // { updatedAt, quotes }
}

// 정적 스냅샷 (첫 로드 — 빠름).
export async function getSnapshot() {
  try {
    const res = await fetch('/data/prices/latest.json', { cache: 'no-cache' });
    if (!res.ok) return { updatedAt: null, quotes: {} };
    return res.json();
  } catch {
    return { updatedAt: null, quotes: {} };
  }
}

async function safeErr(res) {
  try {
    return (await res.json())?.error;
  } catch {
    return null;
  }
}
