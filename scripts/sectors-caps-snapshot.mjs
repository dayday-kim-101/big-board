// 섹터맵 시가총액 주기 갱신 — GitHub Action에서 실행(재료정리와 같은 주기).
// public/data/sectors.json 의 종목별 시총을 네이버 증권에서 받아 갱신한다. 커밋은 워크플로가 담당.
// 조회 실패(일시 오류·상폐 StockConflict 등)한 종목은 기존 값을 유지하고 경고만 남긴다.
import { readFile, writeFile } from 'node:fs/promises';

const SECTORS_PATH = process.env.SECTORS_PATH || 'public/data/sectors.json';
const FETCH_DELAY_MS = 150; // 네이버 rate limit 완화용 코드 간 간격
const FETCH_TIMEOUT_MS = 10_000;
const RETRIES = 2;

// "1,468조 8,775억" / "7,234억" → 조 단위 숫자. 형식이 아니면 null. (순수, 테스트 대상)
export function parseCapText(text) {
  const s = String(text ?? '').replace(/,/g, '').trim();
  if (!s) return null;
  let jo = 0;
  let eok = 0;
  let rest = s;
  if (rest.includes('조')) {
    const [head, tail] = rest.split('조');
    jo = Number(head);
    rest = tail;
  }
  rest = rest.replace('억', '').trim();
  if (rest) eok = Number(rest);
  if (!Number.isFinite(jo) || !Number.isFinite(eok)) return null;
  const total = jo + eok / 10000;
  return total > 0 ? total : null;
}

// caps(코드→조 단위 시총)를 sectors 데이터에 반영하고 섹터 합계를 재계산. (순수, 테스트 대상)
// 반환: 값이 하나라도 바뀌었는지 여부.
export function applyCaps(data, caps) {
  let changed = false;
  for (const sector of data.sectors ?? []) {
    for (const c of sector.companies ?? []) {
      const cap = caps.get(c.code);
      if (!Number.isFinite(cap)) continue;
      const next = Math.round(cap * 10) / 10;
      if (next !== c.capTrillion) {
        c.capTrillion = next;
        changed = true;
      }
    }
    const total = Math.round(sector.companies.reduce((sum, c) => sum + (c.capTrillion || 0), 0) * 10) / 10;
    if (total !== sector.totalCapTrillion) {
      sector.totalCapTrillion = total;
      changed = true;
    }
  }
  return changed;
}

function kstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

async function fetchCap(code) {
  const url = `https://m.stock.naver.com/api/stock/${code}/integration`;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      const row = (d.totalInfos ?? []).find((t) => t.key === '시총');
      return { name: d.stockName ?? '', cap: row ? parseCapText(row.value) : null };
    } catch (e) {
      if (attempt === RETRIES) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return { name: '', cap: null };
}

async function main() {
  const data = JSON.parse(await readFile(SECTORS_PATH, 'utf8'));
  const codes = new Map(); // code → 대표 로컬 이름(경고 메시지용)
  for (const s of data.sectors ?? []) {
    for (const c of s.companies ?? []) if (c.code && !codes.has(c.code)) codes.set(c.code, c.name);
  }
  console.log(`섹터 ${data.sectors.length}개, 종목 ${codes.size}개 시총 조회`);

  const caps = new Map();
  let failed = 0;
  for (const [code, localName] of codes) {
    try {
      const { name, cap } = await fetchCap(code);
      if (Number.isFinite(cap)) caps.set(code, cap);
      else console.warn(`시총 파싱 실패 ${code} ${localName}`);
      // 사명변경 감지용 — 코드 오매핑이면 여기서 드러난다.
      const norm = (v) => String(v).replace(/\s+/g, '').toLowerCase();
      if (name && norm(name) !== norm(localName)) console.warn(`이름 상이 ${code}: 로컬 "${localName}" ↔ API "${name}"`);
    } catch (e) {
      failed += 1;
      console.warn(`조회 실패 ${code} ${localName}: ${e.message} — 기존 값 유지`);
    }
    await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
  }
  console.log(`조회 성공 ${caps.size}/${codes.size} (실패 ${failed})`);

  const changed = applyCaps(data, caps);
  if (!changed) {
    console.log('시총 변동 없음 — 파일 미변경');
    return;
  }
  data.updatedAt = kstToday();
  await writeFile(SECTORS_PATH, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`갱신 완료: ${SECTORS_PATH} (updatedAt=${data.updatedAt})`);
}

// 테스트에서 import할 때 실행되지 않도록 직접 호출일 때만 main.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
