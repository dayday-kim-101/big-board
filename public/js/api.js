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

// 과거 OHLC 캔들 (인터랙티브 차트용). → [{time, open, high, low, close, volume}]
export async function getHistory(market, code, range = '6mo') {
  try {
    const res = await fetch(`/api/history?market=${market}&code=${encodeURIComponent(code)}&range=${range}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.candles) ? data.candles : [];
  } catch {
    return [];
  }
}

// 종목 검색/자동완성. q → [{market, code, name, sub}]
export async function searchTickers(q) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    return [];
  }
}

// Cloudflare Function은 요청당 바깥 fetch 서브리퀘스트 한도(무료 50)가 있고
// /api/quotes는 종목당 fetch 1회를 쓴다. 한 번에 많이 보내면 한도 초과분이
// 조용히 실패하므로(섹터맵 118종목에서 실제 발생) 40개씩 나눠 병렬 요청한다.
const QUOTES_BATCH_SIZE = 40;

// 실시간 시세 (수동 새로고침). items: [{market, code}] → { updatedAt, quotes }
// 일부 배치만 실패하면 성공분을 병합해 반환하고, 전부 실패하면 throw.
export async function getQuotes(items) {
  const list = Array.isArray(items) ? items : [];
  const chunks = [];
  for (let i = 0; i < list.length; i += QUOTES_BATCH_SIZE) {
    chunks.push(list.slice(i, i + QUOTES_BATCH_SIZE));
  }
  if (!chunks.length) return { updatedAt: null, quotes: {} };

  const results = await Promise.allSettled(chunks.map(async (chunk) => {
    const res = await fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: chunk }),
    });
    if (!res.ok) throw new Error(`시세 로드 실패 (${res.status})`);
    return res.json(); // { updatedAt, quotes }
  }));

  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!ok.length) throw results[0].reason;
  const quotes = {};
  let updatedAt = null;
  for (const r of ok) {
    Object.assign(quotes, r.quotes);
    if (r.updatedAt && (!updatedAt || r.updatedAt > updatedAt)) updatedAt = r.updatedAt;
  }
  return { updatedAt, quotes };
}

// 스냅샷 (첫 로드 — 빠름).
// 1순위: /api/snapshot — Function이 GitHub에서 직접 읽어 재배포 없이 항상 최신.
// 폴백: /data/prices/latest.json 정적 파일 (마지막 배포 시점 기준, 다소 오래될 수 있음).
export async function getSnapshot() {
  try {
    const res = await fetch('/api/snapshot');
    if (res.ok) return await res.json();
  } catch {
    /* 폴백으로 진행 */
  }
  try {
    const res = await fetch('/data/prices/latest.json', { cache: 'no-cache' });
    if (res.ok) return await res.json();
  } catch {
    /* 빈 스냅샷 반환 */
  }
  return { updatedAt: null, quotes: {} };
}

// --- 재료정리 보드 ---

// 수집된 날짜 목록 → { dates: [...desc], latest }
export async function getJaelyoDates() {
  try {
    const res = await fetch('/api/jaelyo');
    if (!res.ok) return { dates: [], latest: null };
    const data = await res.json();
    return { dates: Array.isArray(data.dates) ? data.dates : [], latest: data.latest ?? null };
  } catch {
    return { dates: [], latest: null };
  }
}

// 특정일 보드 → { date, rows: [...] }
export async function getJaelyo(date) {
  const res = await fetch(`/api/jaelyo?date=${encodeURIComponent(date)}`);
  if (!res.ok) throw new Error((await safeErr(res)) || `보드 로드 실패 (${res.status})`);
  return res.json();
}

// 수동 필드 부분 저장. manual = 갱신할 키만 담은 객체.
export async function putJaelyoManual(date, code, manual) {
  const res = await fetch(`/api/jaelyo?date=${encodeURIComponent(date)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, manual }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || `저장 실패 (${res.status})`);
  return res.json();
}

// 날짜 단위 오늘의 테마 저장. dailyTheme = { text } 또는 전체 dailyTheme 객체.
export async function putJaelyoDailyTheme(date, dailyTheme) {
  const res = await fetch(`/api/jaelyo?date=${encodeURIComponent(date)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'dailyTheme', dailyTheme }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || `오늘의 테마 저장 실패 (${res.status})`);
  return res.json();
}

// --- 국내증시 한줄메모 ---

export async function getKoreaMarket(email) {
  const res = await fetch(`/api/korea-market?email=${encodeURIComponent(email)}`);
  if (!res.ok) throw new Error((await safeErr(res)) || `국내증시 로드 실패 (${res.status})`);
  return res.json();
}

export async function putKoreaMarketMemo(email, date, memo) {
  const res = await fetch(`/api/korea-market?email=${encodeURIComponent(email)}&date=${encodeURIComponent(date)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memo }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || `국내증시 메모 저장 실패 (${res.status})`);
  return res.json();
}

// --- 매크로 지표 (읽기 전용 정적 파일) ---

// → { collectedAt, seed?, indicators: [...] }. 실패 시 빈 데이터.
export async function getMacro() {
  try {
    const res = await fetch('/data/macro/macro.json', { cache: 'no-cache' });
    if (res.ok) return await res.json();
  } catch {
    /* 빈 데이터 반환 */
  }
  return { collectedAt: null, indicators: [] };
}

// --- 섹터맵 (읽기 전용 정적 파일) ---

// 섹터맵 데이터 (시총 포함). 실패 시 빈 데이터.
// 1순위: /api/sectors — Function이 GitHub에서 직접 읽어 재배포 없이 항상 최신.
// 폴백: /data/sectors.json 정적 파일 (마지막 배포 시점 기준, 다소 오래될 수 있음).
export async function getSectors() {
  try {
    const res = await fetch('/api/sectors');
    if (res.ok) return await res.json();
  } catch {
    /* 폴백으로 진행 */
  }
  try {
    const res = await fetch('/data/sectors.json', { cache: 'no-cache' });
    if (res.ok) return await res.json();
  } catch {
    /* 빈 데이터 반환 */
  }
  return { updatedAt: null, sectors: [] };
}

// --- 매매기록 ---

// 전체 매매기록 로드. 없으면 기본값 반환.
export async function getTrades(email) {
  try {
    const res = await fetch(`/api/trades?email=${encodeURIComponent(email)}`);
    if (!res.ok) return { days: {}, updatedAt: null };
    const data = await res.json();
    return { days: data.days ?? {}, updatedAt: data.updatedAt ?? null };
  } catch {
    return { days: {}, updatedAt: null };
  }
}

// 특정 날짜 records upsert. records = [{code,name,...}]
export async function putTradesUpsert(email, date, records) {
  const res = await fetch(`/api/trades?email=${encodeURIComponent(email)}&date=${encodeURIComponent(date)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'upsert', records }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || `매매기록 저장 실패 (${res.status})`);
  return res.json();
}

// 단일 record 수동 필드(reason/tags/holdDays) 부분 저장.
export async function putTradeManual(email, date, code, manual) {
  const res = await fetch(`/api/trades?email=${encodeURIComponent(email)}&date=${encodeURIComponent(date)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'manual', code, manual }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || `수동 저장 실패 (${res.status})`);
  return res.json();
}

// 날짜별 성공/실패 태그 저장. resultTag = "" | "success" | "failure"
export async function putTradesResultTag(email, date, resultTag) {
  const res = await fetch(`/api/trades?email=${encodeURIComponent(email)}&date=${encodeURIComponent(date)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'resultTag', resultTag }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || `태그 저장 실패 (${res.status})`);
  return res.json();
}

// 날짜별 일지 저장.
export async function putTradesJournal(email, date, journal) {
  const res = await fetch(`/api/trades?email=${encodeURIComponent(email)}&date=${encodeURIComponent(date)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'journal', journal }),
  });
  if (!res.ok) throw new Error((await safeErr(res)) || `일지 저장 실패 (${res.status})`);
  return res.json();
}

async function safeErr(res) {
  try {
    return (await res.json())?.error;
  } catch {
    return null;
  }
}
