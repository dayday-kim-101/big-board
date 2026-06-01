// 주기적 가격 스냅샷 — GitHub Action에서 실행.
// 저장소가 체크아웃된 상태에서 data/users/*.json 을 읽어 종목 합집합을 만들고,
// 시세를 받아 data/prices/latest.json 에 기록한다. 커밋은 워크플로가 담당.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchQuotes } from '../functions/api/_quotes-core.js';

const USERS_DIR = process.env.USERS_DIR || 'data/users';
const OUT_PATH = process.env.OUT_PATH || 'data/prices/latest.json';

// 사용자 객체 배열 → 중복 없는 {market, code} 합집합. (순수, 테스트 대상)
export function collectTickers(userObjects) {
  const seen = new Map();
  for (const user of userObjects) {
    for (const group of user?.groups ?? []) {
      for (const t of group?.tickers ?? []) {
        if (!t?.market || !t?.code) continue;
        const key = `${t.market}:${t.code}`;
        if (!seen.has(key)) seen.set(key, { market: t.market, code: t.code });
      }
    }
  }
  return [...seen.values()];
}

async function readUsers(dir) {
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return []; // 디렉터리 없음 → 사용자 0명
  }
  const users = [];
  for (const f of files) {
    try {
      users.push(JSON.parse(await readFile(path.join(dir, f), 'utf8')));
    } catch (e) {
      console.warn(`사용자 파일 파싱 실패 ${f}: ${e.message}`);
    }
  }
  return users;
}

async function main() {
  const users = await readUsers(USERS_DIR);
  const tickers = collectTickers(users);
  console.log(`사용자 ${users.length}명, 종목 ${tickers.length}개 수집`);

  const quotes = {};
  if (tickers.length) {
    const results = await fetchQuotes(tickers);
    for (const q of results) {
      if (q.ok) quotes[`${q.market}:${q.code}`] = q;
      else console.warn(`시세 실패 ${q.market}:${q.code}: ${q.error}`);
    }
  }

  const snapshot = { updatedAt: new Date().toISOString(), quotes };
  await writeFile(OUT_PATH, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`스냅샷 기록: ${Object.keys(quotes).length}개 → ${OUT_PATH}`);
}

// 직접 실행될 때만 main() (테스트 import 시에는 실행 안 함)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
