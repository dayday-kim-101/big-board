#!/usr/bin/env node
// 국내증시 일별 스냅샷: 재료정리 날짜와 같은 거래일을 기준으로 생성한다.
// 운영은 20시(KST) 이후 실행해서 Naver 장마감/수급/외국인 순매수 데이터가 안정화된 뒤 커밋한다.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { buildReport, parseIndexRow, parseInvestorTrendHtml, parseForeignerTopHtml } from '../functions/api/_korea-market-core.js';

const UA = 'Mozilla/5.0 (compatible; stock-bigboard/0.1)';
const ROOT = process.cwd();
const JAELYO_DIR = path.join(ROOT, 'data/jaelyo');
const OUT_DIR = path.join(ROOT, 'data/korea-market');
const INDEX_CODES = ['KOSPI', 'KOSDAQ', 'KPI200'];
const MARKETS = [
  { key: 'KOSPI', label: '코스피', sosok: '01' },
  { key: 'KOSDAQ', label: '코스닥', sosok: '02' },
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://m.stock.naver.com/' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}
async function getFinanceHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*', Referer: 'https://finance.naver.com/' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = await res.arrayBuffer();
  try { return new TextDecoder('euc-kr').decode(buf); }
  catch { return new TextDecoder().decode(buf); }
}
async function jaelyoDates() {
  const names = await readdir(JAELYO_DIR);
  return names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).filter((d) => DATE_RE.test(d)).sort();
}
async function loadJaelyoBreadth(date) {
  const p = path.join(JAELYO_DIR, `${date}.json`);
  const data = JSON.parse(await readFile(p, 'utf8'));
  const sections = data?.marketSummary?.sections || [];
  return sections
    .filter((s) => s.key === 'KOSPI' || s.key === 'KOSDAQ')
    .map((s) => ({ market: s.key, upCount: s.upCount || 0, downCount: s.downCount || 0, flatCount: s.flatCount || 0, stockCount: s.stockCount || 0 }));
}
async function fetchIndexHistory(targetDates) {
  const byDate = new Map(targetDates.map((d) => [d, {}]));
  for (const code of INDEX_CODES) {
    let page = 1;
    while (page <= 5) {
      const rows = await getJson(`https://m.stock.naver.com/api/index/${code}/price?pageSize=60&page=${page}`);
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const row of rows) {
        const parsed = parseIndexRow(code, row);
        if (byDate.has(parsed.date)) byDate.get(parsed.date)[code] = parsed;
      }
      if (targetDates.every((d) => byDate.get(d)?.[code])) break;
      page += 1;
      await sleep(80);
    }
  }
  return byDate;
}
async function fetchInvestor(date) {
  const out = [];
  for (const m of MARKETS) {
    try {
      const html = await getFinanceHtml(`https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=${date.replace(/-/g, '')}&sosok=${m.sosok}`);
      out.push({ market: m.key, ...parseInvestorTrendHtml(html, date) });
    } catch {
      out.push({ market: m.key, date, personal: null, foreign: null, institution: null });
    }
    await sleep(80);
  }
  return out;
}
async function fetchCurrentForeignerRanks(date = '') {
  const result = { buy: [], sell: [] };
  for (const type of ['buy', 'sell']) {
    for (const m of MARKETS) {
      try {
        const html = await getFinanceHtml(`https://finance.naver.com/sise/sise_deal_rank_iframe.naver?sosok=${m.sosok}&investor_gubun=9000&type=${type}`);
        result[type].push(...parseForeignerTopHtml(html, m.key, date, type).slice(0, 5));
      } catch {}
      await sleep(80);
    }
  }
  return result;
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const dates = await jaelyoDates();
const latest = dates.at(-1) || '';
await mkdir(OUT_DIR, { recursive: true });
const indexHistory = await fetchIndexHistory(dates);
const currentForeignerRanks = await fetchCurrentForeignerRanks(latest);
let changed = 0;
let written = 0;
let missingIndex = 0;
for (const date of dates) {
  const indicesObj = indexHistory.get(date) || {};
  const indices = INDEX_CODES.map((c) => indicesObj[c]).filter(Boolean);
  if (indices.length < INDEX_CODES.length) missingIndex += 1;
  const [breadth, investor] = await Promise.all([loadJaelyoBreadth(date), fetchInvestor(date)]);
  const p = path.join(OUT_DIR, `${date}.json`);
  let prev = '';
  let prevReport = null;
  try {
    prev = await readFile(p, 'utf8');
    prevReport = JSON.parse(prev);
  } catch {}
  const report = buildReport({
    date,
    collectedAt: `${date}T20:00:00+09:00`,
    source: 'naver-static-20kst',
    indices,
    breadth,
    investor,
    // KRX 기준 소스가 붙기 전까지 이미 저장된 과거 스냅샷은 보존하고, 최신일만 현재 수집 가능한 랭킹을 저장한다.
    foreignerTop: date === latest ? currentForeignerRanks.buy : (prevReport?.foreignerTop || []),
    foreignerSellTop: date === latest ? currentForeignerRanks.sell : (prevReport?.foreignerSellTop || []),
  });
  const next = `${JSON.stringify(report, null, 2)}\n`;
  if (prev !== next) {
    changed += 1;
    if (!dryRun) {
      await writeFile(p, next);
      written += 1;
    }
  }
}
console.log(JSON.stringify({ dryRun, dates: dates.length, changed, written, missingIndex, latest, note: 'foreignerTop is exact only for latest/current Naver rank snapshot; historical dates keep empty list unless a saved snapshot exists.' }, null, 2));
