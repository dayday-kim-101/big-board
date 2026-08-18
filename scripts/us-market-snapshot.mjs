#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchUsMarketReports, sanitizeReport } from '../functions/api/_us-market-core.js';

const KOREA_DIR = 'data/korea-market';
const OUT_DIR = 'data/us-market';
const DATE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;

export function kstDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function previousKstDateString(date = new Date()) {
  const kstNoon = new Date(`${kstDateString(date)}T12:00:00+09:00`);
  kstNoon.setUTCDate(kstNoon.getUTCDate() - 1);
  return kstDateString(kstNoon);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { dryRun: false, target: 'all', date: '' };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--target=yesterday-kst') out.target = 'yesterday-kst';
    else if (arg.startsWith('--date=')) { out.target = 'date'; out.date = arg.slice('--date='.length); }
  }
  return out;
}

export function selectSnapshotDates(allDates, opts = {}, now = new Date()) {
  const sorted = [...new Set(allDates)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (opts.target === 'yesterday-kst') {
    const target = previousKstDateString(now);
    if (sorted.includes(target)) return [target];

    // 국내 휴장 다음날(예: 대체공휴일 다음 미국장)에는 어제 국내증시 파일이 없다.
    // 이때는 오늘 한국장이 끝나면 같은 날짜로 맞춰 볼 수 있도록 KST 오늘 날짜의
    // 미국증시 메모를 선생성한다. 평소에는 target(어제)이 존재하므로 기존 동작 유지.
    const today = kstDateString(now);
    return /^\d{4}-\d{2}-\d{2}$/.test(today) ? [today] : [];
  }
  if (opts.target === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? [opts.date] : [];
  return sorted;
}

async function datesFromKoreaMarket() {
  const names = await readdir(KOREA_DIR);
  return names.filter((n) => DATE_RE.test(n)).map((n) => n.slice(0, -5)).sort();
}

async function readExisting(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

function stable(v) {
  return JSON.stringify(v, null, 2) + '\n';
}
function withoutCollectedAt(v) {
  if (!v || typeof v !== 'object') return v;
  const { collectedAt, ...rest } = v;
  return rest;
}

export async function run(argv = process.argv.slice(2), now = new Date()) {
  const opts = parseArgs(argv);
  const allDates = await datesFromKoreaMarket();
  const dates = selectSnapshotDates(allDates, opts, now);
  await mkdir(OUT_DIR, { recursive: true });
  const reports = dates.length ? await fetchUsMarketReports(dates) : [];
  let changed = 0;
  let written = 0;
  const missing = [];
  for (const report of reports) {
    const clean = sanitizeReport(report);
    const hasCore = clean.indices.every((x) => x.close != null) && clean.focus.every((x) => x.close != null) && clean.rates.every((x) => x.close != null);
    if (!hasCore) missing.push(clean.date);
    const path = join(OUT_DIR, `${clean.date}.json`);
    const prev = await readExisting(path);
    const unchangedData = prev && stable(withoutCollectedAt(prev)) === stable(withoutCollectedAt(clean));
    const next = unchangedData ? { ...clean, collectedAt: prev.collectedAt || clean.collectedAt } : clean;
    const nextText = stable(next);
    if (stable(prev) !== nextText) {
      changed += 1;
      if (!opts.dryRun) {
        await writeFile(path, nextText);
        written += 1;
      }
    }
  }
  const result = {
    dryRun: opts.dryRun,
    target: opts.target,
    dates: dates.length,
    changed,
    written,
    missingCoreData: missing.length,
    first: dates[0] || null,
    latest: dates.at(-1) || null,
    source: 'Yahoo Finance daily chart, dates aligned to data/korea-market',
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
