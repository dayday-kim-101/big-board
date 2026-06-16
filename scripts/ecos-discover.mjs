// ECOS 통계표코드/항목코드 탐색 유틸 (개발용 — 매크로 지표 추가 시 사용).
// 키는 환경변수로만 받는다(인자/코드에 박지 말 것). 출력엔 코드·이름만 나오므로 안전하게 공유 가능.
//
// 사용법:
//   ECOS_API_KEY=<키> node scripts/ecos-discover.mjs                 # 외환/대외채무/외채 관련 통계표 검색
//   ECOS_API_KEY=<키> node scripts/ecos-discover.mjs "단기외채"        # 임의 키워드로 통계표 검색
//   ECOS_API_KEY=<키> node scripts/ecos-discover.mjs 732Y001 M        # 특정 통계표의 항목 + 최근 데이터 미리보기
const KEY = process.env.ECOS_API_KEY || '';
if (!KEY) {
  console.error('ECOS_API_KEY 환경변수가 필요합니다.  예: ECOS_API_KEY=xxxx node scripts/ecos-discover.mjs');
  process.exit(1);
}

const DEFAULT_KEYWORDS = ['외환보유', '대외채무', '대외채권', '외채'];

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j?.RESULT) throw new Error(`ECOS: ${j.RESULT.CODE} ${j.RESULT.MESSAGE}`);
  return j;
}

// 통계표 목록에서 키워드 매칭 → STAT_CODE / 주기 / 이름 출력.
async function searchTables(keywords) {
  const j = await getJson(`https://ecos.bok.or.kr/api/StatisticTableList/${KEY}/json/kr/1/3000/`);
  const rows = j?.StatisticTableList?.row ?? [];
  const hits = rows.filter((r) => keywords.some((k) => (r.STAT_NAME || '').includes(k)));
  console.log(`\n통계표 ${rows.length}개 중 매칭 ${hits.length}개 — 키워드: ${keywords.join(', ')}\n`);
  for (const r of hits) {
    console.log(`${r.STAT_CODE}\t주기=${r.CYCLE || '?'}\t${r.STAT_NAME}`);
  }
  console.log('\n→ 원하는 STAT_CODE로 다시 실행: node scripts/ecos-discover.mjs <STAT_CODE> <주기(M/Q/A)>');
}

// 특정 통계표의 항목 목록 + 최근 데이터 미리보기.
async function inspectTable(statCode, cycle = 'M') {
  const items = await getJson(`https://ecos.bok.or.kr/api/StatisticItemList/${KEY}/json/kr/1/200/${statCode}/`);
  const rows = items?.StatisticItemList?.row ?? [];
  console.log(`\n[${statCode}] 항목 ${rows.length}개:\n`);
  for (const r of rows) {
    console.log(`  ITEM=${r.ITEM_CODE || ''}\t${r.ITEM_NAME || ''}\t단위=${r.UNIT_NAME || ''}\t주기=${r.CYCLE || ''}`);
  }
  // 최근 데이터 미리보기(첫 항목 기준).
  const first = rows[0]?.ITEM_CODE;
  const now = new Date();
  const y = now.getUTCFullYear();
  const start = cycle === 'Q' ? `${y - 2}Q1` : cycle === 'A' ? `${y - 5}` : `${y - 1}01`;
  const end = cycle === 'Q' ? `${y}Q4` : cycle === 'A' ? `${y}` : `${y}12`;
  const seg = ['https://ecos.bok.or.kr/api/StatisticSearch', KEY, 'json', 'kr', '1', '10', statCode, cycle, start, end];
  if (first) seg.push(first);
  try {
    const data = await getJson(seg.join('/'));
    const drows = data?.StatisticSearch?.row ?? [];
    console.log(`\n최근 데이터 미리보기 (cycle=${cycle}, item=${first || '전체'}):`);
    for (const r of drows.slice(-6)) console.log(`  ${r.TIME}\t${r.DATA_VALUE}\t${r.UNIT_NAME || ''}`);
  } catch (e) {
    console.log(`\n데이터 미리보기 실패: ${e.message} (주기를 M/Q/A로 바꿔 다시 시도)`);
  }
}

const arg = process.argv[2];
const cycle = process.argv[3];
const isStatCode = arg && /^[0-9A-Z]{6,}$/.test(arg);

(isStatCode ? inspectTable(arg, cycle) : searchTables(arg ? [arg] : DEFAULT_KEYWORDS)).catch((e) => {
  console.error(e.message);
  process.exit(1);
});
