// 매매기록 코어 — trades.js HTTP 핸들러와 공유하는 순수 헬퍼.
// 파일명이 '_'로 시작하므로 Pages Functions 라우트로 노출되지 않는다.
//
// 순수 파서/정제/병합은 네트워크 비의존(테스트 대상).
// 수동필드(reason, tags, holdDays)는 재-upsert 때 절대 덮어쓰지 않는다.
//
// 저장 경로: data/trades/<emailhash>.json
// 스키마 버전: 1

// --- 경로 헬퍼 ---

export function tradesPath(hash) {
  return `data/trades/${hash}.json`;
}

export function emptyTrades() {
  return { version: 1, updatedAt: null, days: {} };
}

// --- 숫자 유틸 ---
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// holdDays 정수 정제(음수/비유효 → 0, undefined/null → 0).
function cleanHoldDays(v) {
  if (v === undefined || v === null) return 0;
  const hd = Math.trunc(Number(v));
  return Number.isFinite(hd) && hd >= 0 ? hd : 0;
}

// --- 매수/매도 판정 ---

// 유효한 양수인지.
function positive(v) {
  const n = num(v);
  return n !== null && n > 0;
}

// 매수 기록: buyAvg/buyAmount 중 하나라도 유효한 양수면 true.
export function isBuyRecord(rec) {
  return !!rec && (positive(rec.buyAvg) || positive(rec.buyAmount));
}

// 매도/청산 기록: sellAvg/sellAmount/qty가 유효한 양수이거나 returnPct가 유효 숫자면 true.
// (returnPct만으로도 키움 당일매매 청산행으로 인정 — 0/음수 수익률도 청산.)
// 이 스키마의 qty는 키움 당일매매의 매도수량(청산 수량)이다.
export function isSellRecord(rec) {
  return (
    !!rec && (positive(rec.sellAvg) || positive(rec.sellAmount) || positive(rec.qty) || num(rec.returnPct) !== null)
  );
}

// YYYY-MM-DD 두 날짜의 calendar day 차이(to - from). 같은 날 0, 다음날 1.
// 음수/비유효는 0으로 clamp.
function calendarDayDiff(fromDate, toDate) {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const diff = Math.round((b - a) / 86400000);
  return diff > 0 ? diff : 0;
}

// days 맵에서 sellDate 이전(<) 날짜 중 code 매수 기록이 있는 가장 최근 날짜를 반환. 없으면 null.
function findMostRecentBuyDate(daysMap, code, sellDate) {
  let best = null;
  for (const [d, day] of Object.entries(daysMap)) {
    if (!DATE_RE.test(d) || d >= sellDate) continue;
    if (!day || !Array.isArray(day.records)) continue;
    const hasBuy = day.records.some(
      (r) => String(r.code ?? '').trim() === code && isBuyRecord(r)
    );
    if (hasBuy && (best === null || d > best)) best = d;
  }
  return best;
}

// --- 보유일 자동 계산 ---

// upsert 직전 incoming records의 holdDays를 자동 계산해 채운다. 순수함수.
// 규칙(매도/청산 기록에만 적용):
//   1. incoming record 자체에 매수+매도가 모두 있으면 holdDays=0 (당일 청산).
//   2. 같은 date 기존 records에 같은 code 매수 기록이 있으면 holdDays=0.
//   3. 이전 날짜들에서 같은 code의 가장 최근 매수일을 찾아 (매도일 - 매수일) 차이.
//   4. 참조 매수일을 못 찾으면 기존 rec.holdDays 정제(없으면 0).
// 매수-only 등 청산이 아닌 기록은 자동 증가하지 않고 rec.holdDays 정제값만 유지.
export function autoFillHoldDaysForUpsert(days, date, incomingRecords) {
  const daysMap = days && typeof days === 'object' && !Array.isArray(days) ? days : {};
  const incoming = Array.isArray(incomingRecords) ? incomingRecords : [];

  return incoming.map((rec) => {
    if (!rec || typeof rec !== 'object') return rec;

    // 청산이 아니면 자동 계산 대상 아님.
    if (!isSellRecord(rec)) {
      return { ...rec, holdDays: cleanHoldDays(rec.holdDays) };
    }

    // 1. 같은 record 안에 매수+매도가 모두 → 당일 청산.
    if (isBuyRecord(rec)) {
      return { ...rec, holdDays: 0 };
    }

    const code = String(rec.code ?? '').trim();

    // 2. 같은 date 기존 records에 같은 code 매수 → 당일 청산.
    const sameDay = daysMap[date];
    if (sameDay && Array.isArray(sameDay.records)) {
      const hasBuySameDay = sameDay.records.some(
        (r) => String(r.code ?? '').trim() === code && isBuyRecord(r)
      );
      if (hasBuySameDay) return { ...rec, holdDays: 0 };
    }

    // 3. 이전 날짜들의 가장 최근 매수일 기준.
    const buyDate = code ? findMostRecentBuyDate(daysMap, code, date) : null;
    if (buyDate) {
      return { ...rec, holdDays: calendarDayDiff(buyDate, date) };
    }

    // 4. 참조 매수일 없음 → 기존 holdDays 정제 or 0.
    return { ...rec, holdDays: cleanHoldDays(rec.holdDays) };
  });
}

// --- 날짜별 결과 태그 정제 ---

// 날짜별 매매 성공/실패 표시. 허용값: "" | "success" | "failure".
// 그 외 값(이상값/undefined/null)은 모두 "" 로 정규화.
export function sanitizeResultTag(v) {
  return v === 'success' || v === 'failure' ? v : '';
}

// --- 수동 필드 정제 ---

// reason, tags, holdDays 세 수동 필드만 받아 정제.
// reason: 문자열, 최대 2000자
// tags: 유니크·비공백 trim 배열, 최대 20개
// holdDays: 정수 ≥ 0
export function sanitizeRecordManual(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;

  if (input.reason !== undefined) {
    out.reason = String(input.reason ?? '').trim().slice(0, 2000);
  }
  if (input.tags !== undefined) {
    const raw = Array.isArray(input.tags) ? input.tags : [];
    const seen = new Set();
    const tags = [];
    for (const t of raw) {
      const s = String(t ?? '').trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        tags.push(s);
        if (tags.length >= 20) break;
      }
    }
    out.tags = tags;
  }
  if (input.holdDays !== undefined) {
    const hd = Math.trunc(Number(input.holdDays));
    out.holdDays = Number.isFinite(hd) && hd >= 0 ? hd : 0;
  }
  return out;
}

// --- 병합 ---

// 기존 records 배열에 incoming records를 (code) 키로 upsert.
// 동일 code가 있으면: 숫자/파생 필드만 갱신, reason/tags/holdDays는 기존 값 보존.
// 없는 code는 끝에 추가. 순수함수.
export function mergeDayRecords(existingRecords, incomingRecords) {
  const existing = Array.isArray(existingRecords) ? existingRecords : [];
  const incoming = Array.isArray(incomingRecords) ? incomingRecords : [];

  // code → index map for O(n) lookup
  const indexMap = new Map();
  const result = existing.map((r, i) => {
    indexMap.set(String(r.code ?? ''), i);
    return { ...r };
  });

  for (const rec of incoming) {
    const code = String(rec.code ?? '').trim();
    if (!code) continue;

    const idx = indexMap.get(code);
    if (idx !== undefined) {
      // 기존 record: 숫자/파생 필드만 갱신, 수동필드 보존
      const prev = result[idx];
      result[idx] = {
        ...prev,
        // 업데이트 가능한 필드들
        name: String(rec.name ?? prev.name ?? ''),
        market: String(rec.market ?? prev.market ?? 'KR'),
        buyAvg: num(rec.buyAvg) ?? prev.buyAvg ?? null,
        sellAvg: num(rec.sellAvg) ?? prev.sellAvg ?? null,
        qty: num(rec.qty) ?? prev.qty ?? null,
        buyAmount: num(rec.buyAmount) ?? prev.buyAmount ?? null,
        sellAmount: num(rec.sellAmount) ?? prev.sellAmount ?? null,
        fee: num(rec.fee) ?? prev.fee ?? null,
        pnl: num(rec.pnl) ?? prev.pnl ?? null,
        returnPct: num(rec.returnPct) ?? prev.returnPct ?? null,
        prevClose: num(rec.prevClose) ?? prev.prevClose ?? null,
        // 수동필드: 기존 값 보존(덮어쓰기 금지)
        reason: prev.reason ?? '',
        tags: prev.tags ?? [],
        holdDays: prev.holdDays ?? 0,
      };
    } else {
      // 신규 code: 끝에 추가, 수동필드는 rec에 있으면 쓰고 없으면 기본값
      const newRec = {
        code,
        name: String(rec.name ?? ''),
        market: String(rec.market ?? 'KR'),
        buyAvg: num(rec.buyAvg),
        sellAvg: num(rec.sellAvg),
        qty: num(rec.qty),
        buyAmount: num(rec.buyAmount),
        sellAmount: num(rec.sellAmount),
        fee: num(rec.fee),
        pnl: num(rec.pnl),
        returnPct: num(rec.returnPct),
        prevClose: num(rec.prevClose),
        holdDays: rec.holdDays !== undefined ? (Math.trunc(Number(rec.holdDays)) >= 0 ? Math.trunc(Number(rec.holdDays)) : 0) : 0,
        reason: typeof rec.reason === 'string' ? rec.reason.trim().slice(0, 2000) : '',
        tags: Array.isArray(rec.tags) ? [...new Set(rec.tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 20) : [],
      };
      indexMap.set(code, result.length);
      result.push(newRec);
    }
  }

  return result;
}

// 특정 day 객체의 code record에 sanitized manual 필드를 부분 병합.
// code 없으면 throw (jaelyo applyManualPatch 패턴).
export function applyRecordManual(day, code, manual) {
  if (!day || !Array.isArray(day.records)) {
    throw new Error(`날짜 데이터가 없거나 records 배열이 없음`);
  }
  const idx = day.records.findIndex((r) => String(r.code ?? '') === String(code));
  if (idx < 0) throw new Error(`종목(${code})을 해당일 records에서 찾을 수 없음`);

  const sanitized = sanitizeRecordManual(manual);
  const nextRecords = day.records.map((r, i) =>
    i === idx ? { ...r, ...sanitized } : r
  );
  return { ...day, records: nextRecords };
}

// --- 정규화 ---

// 전체 trades 파일 구조 검증·정제.
// 구조적으로 잘못된 경우 throw (normalizeList/normalizeBoard 패턴).
export function normalizeTrades(input) {
  if (!input || typeof input !== 'object') throw new Error('trades 데이터가 객체가 아님');

  const version = input.version === 1 ? 1 : 1; // 현재는 버전 1만
  const updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : null;
  const daysIn = input.days;
  if (typeof daysIn !== 'object' || daysIn === null || Array.isArray(daysIn)) {
    throw new Error('days가 객체 맵이 아님');
  }

  const days = {};
  for (const [date, dayVal] of Object.entries(daysIn)) {
    if (!dayVal || typeof dayVal !== 'object') continue;

    const journal = typeof dayVal.journal === 'string' ? dayVal.journal.slice(0, 10000) : '';
    const resultTag = sanitizeResultTag(dayVal.resultTag);
    const recordsIn = Array.isArray(dayVal.records) ? dayVal.records : [];

    const records = [];
    for (const r of recordsIn) {
      if (!r || typeof r !== 'object') continue;
      const code = String(r.code ?? '').trim();
      if (!code) continue;

      // 숫자 필드: Number() 강제 변환 후 finite 아니면 행 거부 (null → null 허용)
      const numField = (v) => {
        if (v === null || v === undefined) return null;
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error(`record(${code}) 숫자 필드가 유효하지 않음: ${v}`);
        return n;
      };

      records.push({
        code,
        name: String(r.name ?? ''),
        market: r.market === 'US' ? 'US' : 'KR',
        buyAvg: numField(r.buyAvg),
        sellAvg: numField(r.sellAvg),
        qty: numField(r.qty),
        buyAmount: numField(r.buyAmount),
        sellAmount: numField(r.sellAmount),
        fee: numField(r.fee),
        pnl: numField(r.pnl),
        returnPct: numField(r.returnPct),
        prevClose: numField(r.prevClose),
        holdDays: (() => {
          const hd = r.holdDays !== undefined && r.holdDays !== null ? Math.trunc(Number(r.holdDays)) : 0;
          return Number.isFinite(hd) && hd >= 0 ? hd : 0;
        })(),
        reason: typeof r.reason === 'string' ? r.reason.slice(0, 2000) : '',
        tags: Array.isArray(r.tags)
          ? [...new Set(r.tags.map((t) => String(t).trim()).filter(Boolean))].slice(0, 20)
          : [],
      });
    }

    days[date] = { journal, resultTag, records };
  }

  return { version, updatedAt, days };
}
