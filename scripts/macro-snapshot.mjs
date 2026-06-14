// 매크로 지표 수집 — GitHub Action에서 실행. 공개 API(Stooq·FRED·ECOS)에서 시계열을 받아
// public/data/macro/macro.json 에 기록한다(정적 서빙). 커밋은 워크플로가 담당.
//
// 필요한 환경변수(미설정 시 해당 소스만 건너뛰고 기존값 유지):
//   FRED_API_KEY  — https://fred.stlouisfed.org/docs/api/api_key.html (무료)
//   ECOS_API_KEY  — https://ecos.bok.or.kr/api/ (무료, 한국은행)
//
// 지표는 INDICATORS 배열에 추가하면 된다. 각 series는 fetch()로 포인트를 받고
// 선택적 transform(v)로 단위를 보정한다. 한 series가 실패하면 그 지표는 기존값을 유지한다.
//
// ⚠️ ECOS 통계표코드/항목코드/단위는 계정별 권한·개정에 따라 다를 수 있어 검증이 필요하다.
//    아래 값은 출발점이며, 실제 키로 https://ecos.bok.or.kr/api/ 통계코드검색에서 확인할 것.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  fetchStooqSeries, fetchFredSeries, fetchEcosSeries,
  cleanPoints, normalizeMacro, hasData,
} from '../functions/api/_macro-core.js';

const OUT_PATH = process.env.MACRO_OUT || 'public/data/macro/macro.json';
const FRED_API_KEY = process.env.FRED_API_KEY || '';
const ECOS_API_KEY = process.env.ECOS_API_KEY || '';

// 수집 기간(ECOS start/end). 넉넉히 최근 4~5년.
const Y = new Date().getUTCFullYear();
const M_START = `${Y - 3}01`;
const M_END = `${Y}12`;
const Q_START = `${Y - 4}Q1`;
const Q_END = `${Y}Q4`;

// 지표 정의. 새 지표는 여기 추가.
const INDICATORS = [
  {
    key: 'dxy', label: '달러인덱스', unit: '', decimals: 2, source: 'ICE / Stooq',
    series: [
      { name: 'DXY', fetch: () => fetchStooqSeries('dx.f') }, // dx.f = ICE 달러인덱스 선물(연속)
    ],
  },
  {
    key: 'us_policy_rate', label: '미국 기준금리', unit: '%', decimals: 2, source: 'FRED (DFEDTARU, 상단)',
    series: [
      { name: '정책금리 상단', fetch: () => fetchFredSeries('DFEDTARU', FRED_API_KEY, { limit: 120 }) },
    ],
  },
  {
    key: 'kr_reserves_extdebt', label: '한국 외환보유액 및 대외채무', unit: '억달러', decimals: 0, source: '한국은행 ECOS',
    series: [
      // TODO(ECOS): 통계표코드/항목코드/단위 확인. 외환보유액(월)은 보통 백만달러 단위 → 억달러로 /100 보정.
      { name: '외환보유액', transform: (v) => v / 100,
        fetch: () => fetchEcosSeries(ECOS_API_KEY, { statCode: '732Y001', cycle: 'M', itemCode: '99', start: M_START, end: M_END }) },
      // TODO(ECOS): 대외채무(분기) 통계표코드/항목코드 확인.
      { name: '대외채무', transform: (v) => v / 100,
        fetch: () => fetchEcosSeries(ECOS_API_KEY, { statCode: '732Y013', cycle: 'Q', itemCode: '', start: Q_START, end: Q_END }) },
    ],
  },
  {
    key: 'kr_st_extdebt', label: '한국 단기외채비중·비율', unit: '%', decimals: 1, source: '한국은행 ECOS',
    series: [
      // TODO(ECOS): 단기외채비중(=단기외채/총대외채무), 단기외채비율(=단기외채/외환보유액) 통계코드 확인.
      { name: '단기외채비중', fetch: () => fetchEcosSeries(ECOS_API_KEY, { statCode: '732Y014', cycle: 'Q', itemCode: '', start: Q_START, end: Q_END }) },
      { name: '단기외채비율', fetch: () => fetchEcosSeries(ECOS_API_KEY, { statCode: '732Y015', cycle: 'Q', itemCode: '', start: Q_START, end: Q_END }) },
    ],
  },
];

async function readExisting(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function buildSeries(s) {
  let pts = await s.fetch();
  if (s.transform) pts = pts.map((p) => ({ date: p.date, value: s.transform(p.value) }));
  return { name: s.name, points: cleanPoints(pts) };
}

async function main() {
  const prev = await readExisting(OUT_PATH);
  const prevByKey = Object.fromEntries((prev?.indicators ?? []).map((i) => [i.key, i]));

  const indicators = [];
  let anyFresh = false;

  for (const cfg of INDICATORS) {
    const series = [];
    for (const s of cfg.series) {
      try {
        series.push(await buildSeries(s));
      } catch (e) {
        console.warn(`수집 실패 [${cfg.key}/${s.name}]: ${e.message}`);
        series.push({ name: s.name, points: [] });
      }
    }
    const fresh = { key: cfg.key, label: cfg.label, unit: cfg.unit, decimals: cfg.decimals, source: cfg.source, series };
    if (hasData(fresh)) {
      anyFresh = true;
      indicators.push(fresh);
    } else if (prevByKey[cfg.key]) {
      console.warn(`[${cfg.key}] 신규 수집값 없음 — 기존값 유지`);
      indicators.push(prevByKey[cfg.key]);
    } else {
      indicators.push(fresh); // 빈 골격이라도 유지(탭에 카드 표시)
    }
  }

  // 단 하나도 새로 못 받았고 기존이 샘플이면 '샘플' 표시 유지(시드 값을 실데이터로 오인 방지).
  const seed = !anyFresh && Boolean(prev?.seed);
  const macro = normalizeMacro({ collectedAt: new Date().toISOString(), seed, indicators });

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(macro, null, 2) + '\n');
  console.log(`매크로 기록: ${indicators.length}개 지표 → ${OUT_PATH} (신규수집=${anyFresh})`);
}

// 직접 실행될 때만 main() (테스트 import 시에는 실행 안 함)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
