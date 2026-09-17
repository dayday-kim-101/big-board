import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePolicyBriefing } from './policy-briefing-api.js';

test('sanitizePolicyBriefing: Top 산업과 출처를 제한하고 URL 없는 출처 제거', () => {
  const out = sanitizePolicyBriefing({
    date: '2026-09-16',
    title: 'x',
    topIndustries: Array.from({ length: 6 }, (_, i) => ({ rank: i + 1, name: `산업${i}`, score: 80 - i, reason: 'r', koreaConnection: 'k' })),
    changes: { us: 'u', global: 'g', korea: 'k' },
    risks: ['a', 'b', 'c', 'd'],
    sources: [
      { label: 'Reuters: Fed와 금리전망', url: 'https://example.com/1' },
      { label: 'bad', url: 'ftp://example.com/2' },
    ],
  });
  assert.equal(out.date, '2026-09-16');
  assert.equal(out.topIndustries.length, 5);
  assert.equal(out.risks.length, 3);
  assert.deepEqual(out.sources, [{ label: 'Reuters: Fed와 금리전망', url: 'https://example.com/1' }]);
});
