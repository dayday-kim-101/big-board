import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCapText, applyCaps } from './sectors-caps-snapshot.mjs';

test('parseCapText: 조+억, 억 단독, 콤마 처리', () => {
  assert.equal(parseCapText('1,468조 8,775억'), 1468.8775);
  assert.equal(parseCapText('389조'), 389);
  assert.equal(parseCapText('7,234억'), 0.7234);
  assert.equal(parseCapText('245억'), 0.0245);
});

test('parseCapText: 비정상 입력은 null', () => {
  assert.equal(parseCapText(''), null);
  assert.equal(parseCapText(null), null);
  assert.equal(parseCapText('N/A'), null);
  assert.equal(parseCapText('0억'), null);
});

function sampleData() {
  return {
    updatedAt: '2026-07-21',
    sectors: [
      {
        name: '반도체',
        totalCapTrillion: 100,
        companies: [
          { name: 'A', code: '000001', capTrillion: 60 },
          { name: 'B', code: '000002', capTrillion: 40 },
        ],
      },
    ],
  };
}

test('applyCaps: 시총 반영(0.1조 반올림) + 섹터 합계 재계산, 변경 여부 반환', () => {
  const data = sampleData();
  const changed = applyCaps(data, new Map([['000001', 65.04], ['000002', 40]]));
  assert.equal(changed, true);
  assert.equal(data.sectors[0].companies[0].capTrillion, 65);
  assert.equal(data.sectors[0].companies[1].capTrillion, 40);
  assert.equal(data.sectors[0].totalCapTrillion, 105);
});

test('applyCaps: 조회 실패 종목(caps에 없음)은 기존 값 유지', () => {
  const data = sampleData();
  const changed = applyCaps(data, new Map([['000001', 61]]));
  assert.equal(changed, true);
  assert.equal(data.sectors[0].companies[1].capTrillion, 40); // 유지
  assert.equal(data.sectors[0].totalCapTrillion, 101);
});

test('applyCaps: 값 동일하면 changed=false, 데이터 불변', () => {
  const data = sampleData();
  const changed = applyCaps(data, new Map([['000001', 60], ['000002', 40]]));
  assert.equal(changed, false);
  assert.equal(data.sectors[0].totalCapTrillion, 100);
});
