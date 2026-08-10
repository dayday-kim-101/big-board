#!/usr/bin/env node
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchUsMarketReports, sanitizeReport } from '../functions/api/_us-market-core.js';

const DRY = process.argv.includes('--dry-run');
const KOREA_DIR = 'data/korea-market';
const OUT_DIR = 'data/us-market';
const DATE_RE = /^\d{4}-\d{2}-\d{2}\.json$/;

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

const dates = await datesFromKoreaMarket();
await mkdir(OUT_DIR, { recursive: true });
const reports = await fetchUsMarketReports(dates);
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
    if (!DRY) {
      await writeFile(path, nextText);
      written += 1;
    }
  }
}
console.log(JSON.stringify({ dryRun: DRY, dates: dates.length, changed, written, missingCoreData: missing.length, first: dates[0] || null, latest: dates.at(-1) || null, source: 'Yahoo Finance daily chart, dates aligned to data/korea-market' }, null, 2));
