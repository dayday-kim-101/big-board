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
  fetchYahooOHLC, fetchFredSeries, fetchEcosSeries, fetchDbnomicsSeries,
  cleanPoints, mergePoints, normalizeMacro,
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
    key: 'dxy', label: '달러인덱스', unit: '', decimals: 2, source: 'ICE / Yahoo',
    series: [
      // 일별 OHLC 2년치 → 봉차트. 주/월/연봉은 프런트가 일봉을 집계. maxPoints는 거래일 2년(~520) 여유분.
      { name: 'DXY', maxPoints: 600, fetch: () => fetchYahooOHLC('DX-Y.NYB', { range: '2y' }) },
    ],
  },
  {
    key: 'ism', label: 'ISM PMI', unit: '', decimals: 1, source: 'ISM / DBnomics',
    // 50 미만은 경기 수축(침체) 신호. 제조업·서비스업 둘 다 같은 기준선.
    threshold: { value: 50, belowIsBad: true, label: '침체' },
    series: [
      // 월별 헤드라인 PMI(무인증). maxPoints ~10년(120개월).
      // valid: PMI 실측 역사범위(2008 저점 ~33, 고점 ~70대) 밖은 소스 오염 → 제외(예: DBnomics에 간헐적 ~10값).
      { name: '제조업', maxPoints: 120, valid: (v) => v >= 20 && v <= 85, fetch: () => fetchDbnomicsSeries('ISM', 'pmi', 'pm') },
      { name: '서비스업', maxPoints: 120, valid: (v) => v >= 20 && v <= 85, fetch: () => fetchDbnomicsSeries('ISM', 'nm-pmi', 'pm') },
    ],
  },
  {
    key: 'hy_oas', label: '하이일드 신용 스프레드', unit: '%', decimals: 2, source: 'ICE BofA / FRED',
    category: 'crisis', // 금융위기 탭. 5% 초과 = 경계(높을수록 위험).
    threshold: { value: 5, aboveIsBad: true, label: '경계' },
    series: [
      // 일별 OAS. FRED는 2026년부터 최근 3년만 배포 → accumulate로 매 수집마다 누적(maxPoints ~20년치).
      { name: 'HY OAS', accumulate: true, maxPoints: 5200,
        fetch: () => fetchFredSeries('BAMLH0A0HYM2', FRED_API_KEY, { limit: 800 }) },
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
      // 외환보유액(월) 732Y001 item=99: ECOS 단위 천달러 → 억달러로 /100000 보정(워크플로 실측으로 확인).
      { name: '외환보유액', transform: (v) => v / 100000,
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
  // transform은 단위 보정용 — value와 함께 OHLC도 같은 배율로 보정(봉차트 보존).
  if (s.transform) {
    pts = pts.map((p) => {
      const out = { ...p, value: s.transform(p.value) };
      for (const k of ['open', 'high', 'low', 'close']) {
        if (typeof p[k] === 'number') out[k] = s.transform(p[k]);
      }
      return out;
    });
  }
  // valid(v): 신뢰구간 밖 값 제외(소스 결측·오염 방어). 예: ISM PMI는 0~100 지표라 ~10 같은 값은 오염.
  if (s.valid) pts = pts.filter((p) => s.valid(p.value));
  return { name: s.name, points: cleanPoints(pts, s.maxPoints ?? 60) };
}

async function main() {
  const prev = await readExisting(OUT_PATH);
  const prevByKey = Object.fromEntries((prev?.indicators ?? []).map((i) => [i.key, i]));

  const indicators = [];
  let anyFresh = false;

  for (const cfg of INDICATORS) {
    // 직전 파일의 같은 지표 시리즈(이름 기준) — 시리즈별 실패 시 폴백용.
    const prevSeries = Object.fromEntries((prevByKey[cfg.key]?.series ?? []).map((s) => [s.name, s]));
    const series = [];
    for (const s of cfg.series) {
      let built;
      try {
        built = await buildSeries(s);
      } catch (e) {
        console.warn(`수집 실패 [${cfg.key}/${s.name}]: ${e.message}`);
        built = { name: s.name, points: [] };
      }
      if (built.points.length > 0) {
        anyFresh = true;
        // accumulate: 소스가 롤링 윈도우(예: FRED 3년)만 줘도 이전 히스토리와 합쳐 누적.
        if (s.accumulate && prevSeries[s.name]?.points?.length) {
          const merged = mergePoints(prevSeries[s.name].points, built.points, s.maxPoints ?? 0);
          console.log(`[${cfg.key}/${s.name}] 누적: 이전 ${prevSeries[s.name].points.length} + 신규 ${built.points.length} → ${merged.length}`);
          built = { name: s.name, points: merged };
        }
      } else if (prevSeries[s.name]?.points?.length) {
        console.warn(`[${cfg.key}/${s.name}] 신규값 없음 — 기존값 유지`);
        built = { name: s.name, points: prevSeries[s.name].points };
      }
      series.push(built);
    }
    indicators.push({
      key: cfg.key, label: cfg.label, unit: cfg.unit, decimals: cfg.decimals, source: cfg.source, series,
      ...(cfg.threshold ? { threshold: cfg.threshold } : {}),
      ...(cfg.category ? { category: cfg.category } : {}),
    });
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
