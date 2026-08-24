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
import { inflateRawSync } from 'node:zlib';
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

const GPR_DAILY_URL = 'https://raw.githubusercontent.com/iacoviel/iacoviel.github.io/master/gpr_files/data_gpr_daily_recent.dta';
let gprDailyCache = null;

function xmlText(s = '') {
  return String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function columnIndex(ref = '') {
  const letters = String(ref).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function unzipEntry(buf, wantedName) {
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === eocdSig) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('XLSX ZIP EOCD 없음');
  const entries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  let p = cdOffset;
  for (let i = 0; i < entries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('XLSX central directory 오류');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (name === wantedName) {
      if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('XLSX local header 오류');
      const localNameLen = buf.readUInt16LE(localOffset + 26);
      const localExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLen + localExtraLen;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return data.toString('utf8');
      if (method === 8) return inflateRawSync(data).toString('utf8');
      throw new Error(`지원하지 않는 XLSX 압축 방식: ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`XLSX 엔트리 없음: ${wantedName}`);
}

function parseSharedStrings(xml) {
  return [...String(xml).matchAll(/<si[\s\S]*?<\/si>/g)].map((m) => {
    const parts = [...m[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1]));
    return parts.join('');
  });
}

export function parseOpenXmlWorksheetRows(sheetXml, sharedStrings = []) {
  const rows = [];
  for (const rowMatch of String(sheetXml).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = c[1];
      const body = c[2];
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1] || '';
      const idx = columnIndex(ref);
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] || '';
      const raw = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1]
        ?? body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1]
        ?? '';
      const text = xmlText(raw);
      if (idx < 0) continue;
      if (type === 's') row[idx] = sharedStrings[Number(text)] ?? '';
      else if (type === 'inlineStr' || type === 'str') row[idx] = text;
      else {
        const n = Number(text);
        row[idx] = Number.isFinite(n) && text !== '' ? n : text;
      }
    }
    if (row.some((v) => v !== undefined && v !== '')) rows.push(row);
  }
  return rows;
}

function parseGprDate(value) {
  const s = String(Math.trunc(Number(value)) || value || '').trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

export function parseGprDailyRows(rows = []) {
  const header = (rows[0] || []).map((x) => String(x || '').trim());
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const pick = (row, key) => {
    const v = Number(row[idx[key]]);
    return Number.isFinite(v) ? v : null;
  };
  const series = { composite: [], threat: [], act: [] };
  for (const row of rows.slice(1)) {
    const date = parseGprDate(row[idx.DATE]);
    if (!date) continue;
    const composite = pick(row, 'GPRD*');
    const threat = pick(row, 'GPRD_THREAT');
    const act = pick(row, 'GPRD_ACT');
    if (composite != null) series.composite.push({ date, value: composite });
    if (threat != null) series.threat.push({ date, value: threat });
    if (act != null) series.act.push({ date, value: act });
  }
  for (const key of Object.keys(series)) series[key].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return series;
}

function tagBody(buf, tag) {
  const open = Buffer.from(`<${tag}>`);
  const close = Buffer.from(`</${tag}>`);
  const a = buf.indexOf(open);
  if (a < 0) throw new Error(`DTA 태그 없음: ${tag}`);
  const start = a + open.length;
  const b = buf.indexOf(close, start);
  if (b < 0) throw new Error(`DTA 닫는 태그 없음: ${tag}`);
  return buf.subarray(start, b);
}

function stataTypeSize(type) {
  if (type >= 1 && type <= 2045) return type;
  if (type === 65526) return 8; // double
  if (type === 65527) return 4; // float
  if (type === 65528) return 4; // long
  if (type === 65529) return 2; // int
  if (type === 65530) return 1; // byte
  throw new Error(`지원하지 않는 Stata 타입: ${type}`);
}

function readStataValue(buf, offset, type) {
  if (type >= 1 && type <= 2045) return buf.subarray(offset, offset + type).toString('utf8').replace(/\0+$/g, '').trim();
  if (type === 65526) return buf.readDoubleLE(offset);
  if (type === 65527) return buf.readFloatLE(offset);
  if (type === 65528) return buf.readInt32LE(offset);
  if (type === 65529) return buf.readInt16LE(offset);
  if (type === 65530) return buf.readInt8(offset);
  return null;
}

export function parseStata118Rows(buf) {
  const release = tagBody(buf, 'release').toString('utf8');
  if (release !== '118') throw new Error(`지원하지 않는 Stata release: ${release}`);
  const byteorder = tagBody(buf, 'byteorder').toString('utf8');
  if (byteorder !== 'LSF') throw new Error(`지원하지 않는 Stata byteorder: ${byteorder}`);
  const k = tagBody(buf, 'K').readUInt16LE(0);
  const n = Number(tagBody(buf, 'N').readBigUInt64LE(0));
  const typeBytes = tagBody(buf, 'variable_types');
  const types = Array.from({ length: k }, (_, i) => typeBytes.readUInt16LE(i * 2));
  const nameBytes = tagBody(buf, 'varnames');
  const names = Array.from({ length: k }, (_, i) => nameBytes.subarray(i * 129, (i + 1) * 129).toString('utf8').split('\0')[0]);
  const rowSize = types.reduce((sum, t) => sum + stataTypeSize(t), 0);
  const dataStart = buf.indexOf(Buffer.from('<data>')) + 6;
  if (dataStart < 6) throw new Error('DTA data 섹션 없음');
  const rows = [];
  for (let r = 0; r < n; r++) {
    let p = dataStart + r * rowSize;
    const row = {};
    for (let c = 0; c < k; c++) {
      row[names[c]] = readStataValue(buf, p, types[c]);
      p += stataTypeSize(types[c]);
    }
    rows.push(row);
  }
  return rows;
}

export function parseGprDailyRecords(records = []) {
  const series = { composite: [], threat: [], act: [] };
  for (const row of records) {
    const date = parseGprDate(row.DAY);
    if (!date) continue;
    const composite = Number(row.GPRD);
    const threat = Number(row.GPRD_THREAT);
    const act = Number(row.GPRD_ACT);
    if (Number.isFinite(composite)) series.composite.push({ date, value: composite });
    if (Number.isFinite(threat)) series.threat.push({ date, value: threat });
    if (Number.isFinite(act)) series.act.push({ date, value: act });
  }
  for (const key of Object.keys(series)) series[key].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return series;
}

export async function fetchGprDailySeries(url = GPR_DAILY_URL) {
  const res = await fetch(url, { headers: { 'User-Agent': 'stock-bigboard/0.1', Accept: 'application/octet-stream,*/*' } });
  if (!res.ok) throw new Error(`GPR DTA ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return parseGprDailyRecords(parseStata118Rows(buf));
}

async function getGprDailySeries() {
  if (!gprDailyCache) gprDailyCache = fetchGprDailySeries();
  return gprDailyCache;
}

// 지표 정의. 새 지표는 여기 추가. (테스트에서 정의 검증용으로 export)
export const INDICATORS = [
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
      // valid: HY OAS 실측 역사범위(평시 ~3%, 2008 고점 ~22%) 밖은 오염 → 제외. 누적되면 영구 저장되므로 입구에서 차단.
      { name: 'HY OAS', accumulate: true, maxPoints: 5200, valid: (v) => v >= 0 && v <= 30,
        fetch: () => fetchFredSeries('BAMLH0A0HYM2', FRED_API_KEY, { limit: 800 }) },
    ],
  },
  {
    key: 'gpr_daily', label: '지정학적 리스크 지수', unit: '', decimals: 1, source: 'Caldara & Iacoviello GPR / GitHub',
    category: 'crisis', // 금융위기 탭. 100 초과 = 장기 평균보다 지정학 리스크가 높음.
    threshold: { value: 100, aboveIsBad: true, label: '고조' },
    series: [
      // Caldara & Iacoviello daily GPR. 공개 Stata(DTA)의 1985년 이후 일별 전체 히스토리를 최대한 보존.
      { name: '종합 GPR', maxPoints: 20000, valid: (v) => v >= 0 && v <= 3000,
        fetch: async () => (await getGprDailySeries()).composite },
      { name: '위협', maxPoints: 20000, valid: (v) => v >= 0 && v <= 3000,
        fetch: async () => (await getGprDailySeries()).threat },
      { name: '현실화', maxPoints: 20000, valid: (v) => v >= 0 && v <= 3000,
        fetch: async () => (await getGprDailySeries()).act },
    ],
  },
  {
    key: 'us_policy_rate', label: '미국 기준금리', unit: '%', decimals: 2, source: 'FRED (DFEDTARU, 상단)',
    series: [
      { name: '정책금리 상단', fetch: () => fetchFredSeries('DFEDTARU', FRED_API_KEY, { limit: 120 }) },
    ],
  },
  {
    key: 'us_treasury_yield', label: '미국 국채금리', unit: '%', decimals: 2, source: 'FRED (DGS10, DGS2)',
    series: [
      // 일별 국채 수익률(연%). FRED는 최근 윈도우만 줄 수 있어 accumulate로 누적(maxPoints ~2년 거래일).
      // valid: 미 국채 수익률 실측 역사범위(마이너스 금리 없음, 1980년대 고점 ~16%) 밖은 오염 → 제외.
      { name: '10년물', accumulate: true, maxPoints: 520, valid: (v) => v >= 0 && v <= 20,
        fetch: () => fetchFredSeries('DGS10', FRED_API_KEY, { limit: 250 }) },
      { name: '2년물', accumulate: true, maxPoints: 520, valid: (v) => v >= 0 && v <= 20,
        fetch: () => fetchFredSeries('DGS2', FRED_API_KEY, { limit: 250 }) },
    ],
  },
  {
    key: 'us_yield_spread', label: '미국 장단기 금리차(10Y-2Y)', unit: '%p', decimals: 2, source: 'FRED (T10Y2Y)',
    // 0 미만(역전) = 경기침체 선행신호. 음수일수록 위험하므로 belowIsBad.
    threshold: { value: 0, belowIsBad: true, label: '역전' },
    series: [
      // 일별 10Y-2Y 스프레드(%p). 음수 가능하므로 valid는 합리적 역사범위(-3 ~ +4%p)만 통과.
      { name: '10Y-2Y', accumulate: true, maxPoints: 520, valid: (v) => v >= -3 && v <= 4,
        fetch: () => fetchFredSeries('T10Y2Y', FRED_API_KEY, { limit: 250 }) },
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
