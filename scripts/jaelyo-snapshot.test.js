// jaelyo-snapshot 순수 헬퍼 테스트 — node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kstDateString,
  pickPrevDate,
  isTradingDay,
  alreadyCollected,
  resolveTargetDate,
} from './jaelyo-snapshot.mjs';

test('kstDateString: UTC → KST(+9) 날짜', () => {
  // 2026-05-07 06:40 UTC = 2026-05-07 15:40 KST (같은 날)
  assert.equal(kstDateString(new Date('2026-05-07T06:40:00Z')), '2026-05-07');
  // 2026-05-07 16:00 UTC = 2026-05-08 01:00 KST (다음 날로 넘어감)
  assert.equal(kstDateString(new Date('2026-05-07T16:00:00Z')), '2026-05-08');
  // 2026-05-06 15:30 UTC = 2026-05-07 00:30 KST
  assert.equal(kstDateString(new Date('2026-05-06T15:30:00Z')), '2026-05-07');
});

test('pickPrevDate: today 미만 최신 날짜', () => {
  const dates = ['2026-05-09', '2026-05-08', '2026-05-07'];
  assert.equal(pickPrevDate(dates, '2026-05-09'), '2026-05-08');
  assert.equal(pickPrevDate(dates, '2026-05-08'), '2026-05-07');
});

test('pickPrevDate: 이전 날짜 없음 → null', () => {
  assert.equal(pickPrevDate(['2026-05-07'], '2026-05-07'), null);
  assert.equal(pickPrevDate([], '2026-05-07'), null);
  assert.equal(pickPrevDate(['2026-05-10'], '2026-05-07'), null);
});

test('isTradingDay: 네이버 거래일 == 오늘일 때만 참(공휴일/주말 가드)', () => {
  assert.equal(isTradingDay('2026-06-11', '2026-06-11'), true);
  assert.equal(isTradingDay('2026-06-05', '2026-06-08'), false); // 6/6 현충일 끼인 직후 등 휴장일
  assert.equal(isTradingDay(null, '2026-06-11'), false);
  assert.equal(isTradingDay(undefined, '2026-06-11'), false);
});

test('alreadyCollected: 행이 있으면 참(재시도 창 멱등 가드)', () => {
  assert.equal(alreadyCollected({ rows: [{ code: '005930' }] }), true);
  assert.equal(alreadyCollected({ rows: [] }), false); // 빈 파일은 미수집으로 취급 → 재수집 허용
  assert.equal(alreadyCollected(null), false); // 파일 없음
  assert.equal(alreadyCollected({}), false);
});

test('resolveTargetDate: today 기준 정상 수집(거래일==오늘, 파일 없음) → 그 거래일 작성', () => {
  // 예약이 제때 실행: today=tradedDate=2026-07-07, 아직 파일 없음 → 2026-07-07 작성
  assert.equal(resolveTargetDate('2026-07-07', null), '2026-07-07');
});

test('resolveTargetDate: 지연 실행 → 네이버 거래일(직전 거래일) 파일을 작성', () => {
  // 예약이 KST 자정을 넘겨 실행: today=2026-07-07이지만 네이버 거래일=2026-07-06.
  // 2026-07-06 파일이 아직 없으므로 그 날짜로 백필 대상이 된다.
  assert.equal(resolveTargetDate('2026-07-06', null), '2026-07-06');
  assert.equal(resolveTargetDate('2026-07-06', { rows: [] }), '2026-07-06'); // 빈 파일도 재수집 허용
});

test('resolveTargetDate: 휴장/중복 → 이미 수집된 거래일이면 skip(null)', () => {
  // 거래일 2026-07-06 파일에 이미 rows가 있음 → 재시도/휴장일 재실행 모두 미작성.
  assert.equal(resolveTargetDate('2026-07-06', { rows: [{ code: '005930' }] }), null);
});

test('resolveTargetDate: 네이버 거래일 미확인 → null(파일 미작성)', () => {
  assert.equal(resolveTargetDate(null, null), null);
  assert.equal(resolveTargetDate(undefined, null), null);
});

test('지연 실행 시 전일순위 기준은 네이버 거래일 직전 개장일(2026-07-03)', () => {
  // 백필 대상=2026-07-06일 때 전일순위는 07-06 미만 최신 파일(2026-07-03)에서 온다.
  const dates = ['2026-07-01', '2026-07-02', '2026-07-03'];
  assert.equal(pickPrevDate(dates, '2026-07-06'), '2026-07-03');
});
