export function sanitizePolicyBriefing(input = {}) {
  const topIndustries = Array.isArray(input.topIndustries) ? input.topIndustries.slice(0, 5).map((x, i) => ({
    rank: Number.isFinite(Number(x.rank)) ? Number(x.rank) : i + 1,
    name: String(x.name || '').slice(0, 80),
    score: Number.isFinite(Number(x.score)) ? Number(x.score) : null,
    reason: String(x.reason || '').slice(0, 300),
    koreaConnection: String(x.koreaConnection || '').slice(0, 300),
  })) : [];
  const sources = Array.isArray(input.sources) ? input.sources.slice(0, 5).map((x) => ({
    label: String(x.label || '출처').slice(0, 80),
    url: String(x.url || ''),
  })).filter((x) => /^https?:\/\//.test(x.url)) : [];
  return {
    date: String(input.date || ''),
    title: String(input.title || '').slice(0, 120),
    generatedAt: String(input.generatedAt || ''),
    status: String(input.status || ''),
    summary: String(input.summary || '').slice(0, 300),
    topIndustries,
    changes: {
      us: String(input.changes?.us || '').slice(0, 200),
      global: String(input.changes?.global || '').slice(0, 200),
      korea: String(input.changes?.korea || '').slice(0, 200),
    },
    risks: Array.isArray(input.risks) ? input.risks.slice(0, 3).map((x) => String(x).slice(0, 200)) : [],
    sources,
  };
}

export async function getPolicyBriefing(date = '') {
  const indexRes = await fetch('/data/policy-briefings/index.json', { cache: 'no-cache' });
  if (!indexRes.ok) return { dates: [], latest: null, report: null };
  const index = await indexRes.json();
  const dates = Array.isArray(index.dates) ? index.dates : [];
  const selected = date || index.latest || dates[0] || null;
  if (!selected) return { dates, latest: index.latest ?? null, report: null };
  const reportRes = await fetch(`/data/policy-briefings/${encodeURIComponent(selected)}.json`, { cache: 'no-cache' });
  if (!reportRes.ok) return { dates, latest: index.latest ?? null, report: null };
  const report = sanitizePolicyBriefing(await reportRes.json());
  return { dates, latest: index.latest ?? dates[0] ?? null, report };
}
