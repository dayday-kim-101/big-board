#!/usr/bin/env node
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildDailyTheme, normalizeBoard } from '../functions/api/_jaelyo-core.js';

const DIR = process.env.JAELYO_DIR || 'data/jaelyo';
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const NOW = process.env.JAELYO_DAILY_THEME_NOW || new Date().toISOString();

async function listDateFiles(dir) {
  return (await readdir(dir))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
}

function shouldSkip(board) {
  return !FORCE && board?.dailyTheme?.source === 'manual';
}

async function main() {
  const files = await listDateFiles(DIR);
  const summary = { dir: DIR, dryRun: DRY_RUN, force: FORCE, totalFiles: files.length, changed: 0, skippedManual: 0, themes: [] };
  for (const file of files) {
    const p = path.join(DIR, file);
    const board = JSON.parse(await readFile(p, 'utf8'));
    if (shouldSkip(board)) {
      summary.skippedManual += 1;
      continue;
    }
    const dailyTheme = buildDailyTheme(board.rows || [], { now: board.collectedAt || NOW });
    const next = normalizeBoard({ ...board, dailyTheme });
    const before = JSON.stringify(board.dailyTheme || null);
    const after = JSON.stringify(next.dailyTheme || null);
    if (before !== after) {
      summary.changed += 1;
      summary.themes.push({ date: next.date, text: next.dailyTheme.text, topTheme: next.dailyTheme.items?.[0]?.theme || '' });
      if (!DRY_RUN) await writeFile(p, JSON.stringify(next, null, 2) + '\n');
    }
  }
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
