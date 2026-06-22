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

    days[date] = { journal, records };
  }

  return { version, updatedAt, days };
}
