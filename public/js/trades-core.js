// 매매기록 클라이언트 순수 헬퍼 — DOM·네트워크 없음, node --test 대상.

// 따옴표·쉼표·% 제거 후 숫자 변환. 실패 시 null.
function parseNum(s) {
  if (s === null || s === undefined) return null;
  const clean = String(s).replace(/["'\s,]/g, '').replace('%', '');
  if (clean === '' || clean === '-') return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

// 선행 작은따옴표(키움 코드 앞 `'`) 및 공백 제거.
function parseCode(s) {
  return String(s ?? '').replace(/^['"\s]+/, '').replace(/["\s]+$/, '').trim();
}

/**
 * parseKiwoomClipboard(text) — 키움 "당일매매" 클립보드(탭 구분 텍스트)를 파싱.
 * 헤더 2줄 스킵, 이후 14컬럼 이상 행을 record로 변환.
 * 컬럼 순서(0-indexed):
 *   0 code, 1 name, 2 buyAvg, 3 buyQty, 4 buyAmount, 5 sellAvg,
 *   6 sellQty, 7 sellAmount, 8 fee, 9 pnl, 10 returnPct, 11 대출일, 12 신용구분, 13 이전매입가
 * 반환: {code, name, market:'KR', buyAvg, sellAvg, qty, buyAmount, sellAmount, fee, pnl, returnPct}[]
 */
export function parseKiwoomClipboard(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/);
  const records = [];

  // 헤더 2줄 스킵
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].replace(/^\s+/, ''); // 선행 공백만 제거 — 후행 탭(빈 컬럼) 보존
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length < 14) continue;

    const code = parseCode(cols[0]);
    if (!code) continue;

    const buyAvg = parseNum(cols[2]);
    const buyQty = parseNum(cols[3]);
    const buyAmount = parseNum(cols[4]);
    const sellAvg = parseNum(cols[5]);
    const sellQty = parseNum(cols[6]);
    const sellAmount = parseNum(cols[7]);
    const fee = parseNum(cols[8]);
    const pnl = parseNum(cols[9]);
    // returnPct: "-10.28%" → -10.28
    const returnPctRaw = String(cols[10] ?? '').replace(/["'\s,]/g, '').replace('%', '');
    const returnPct = returnPctRaw === '' ? null : (Number.isFinite(Number(returnPctRaw)) ? Number(returnPctRaw) : null);

    records.push({
      code,
      name: String(cols[1] ?? '').replace(/^["'\s]+/, '').replace(/["'\s]+$/, '').trim(),
      market: 'KR',
      buyAvg,
      sellAvg,
      qty: sellQty,
      buyAmount,
      sellAmount,
      fee,
      pnl,
      returnPct,
    });
  }

  return records;
}

/**
 * pickPrevClose(candles, date) — candles: [{time:'YYYY-MM-DD', close}]
 * date 이전 마지막 거래일의 close를 반환. 없으면 null.
 */
export function pickPrevClose(candles, date) {
  if (!Array.isArray(candles) || !date) return null;
  // date 미만인 캔들들 중 가장 마지막(최신) close
  let best = null;
  for (const c of candles) {
    if (c.time < date) {
      if (best === null || c.time > best.time) best = c;
    }
  }
  return best !== null && Number.isFinite(best.close) ? best.close : null;
}

/**
 * computeStats(records) — 모든 날짜에 걸친 record 배열로 누적 통계 계산.
 * 반환: { winRate, cumPnl, avgReturn, tradeCount,
 *          byTheme: { tag: { count, pnl, winRate } },
 *          byStock: { code: { name, count, pnl, winRate } },
 *          byHoldPeriod: { '0':{count,pnl}, '1':{count,pnl}, '2-4':{count,pnl}, '5+':{count,pnl} } }
 * 승률: returnPct > 0인 건 / 전체(본전 0%는 비승).
 */
export function computeStats(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return {
      winRate: 0, cumPnl: 0, avgReturn: 0, tradeCount: 0,
      byTheme: {}, byStock: {}, byHoldPeriod: { '0': { count: 0, pnl: 0 }, '1': { count: 0, pnl: 0 }, '2-4': { count: 0, pnl: 0 }, '5+': { count: 0, pnl: 0 } },
    };
  }

  let wins = 0;
  let cumPnl = 0;
  let sumReturn = 0;
  let validReturn = 0;
  const byTheme = {};
  const byStock = {};
  const byHoldPeriod = {
    '0': { count: 0, pnl: 0 },
    '1': { count: 0, pnl: 0 },
    '2-4': { count: 0, pnl: 0 },
    '5+': { count: 0, pnl: 0 },
  };

  for (const r of records) {
    const pnl = Number.isFinite(r.pnl) ? r.pnl : 0;
    const ret = Number.isFinite(r.returnPct) ? r.returnPct : null;

    if (ret !== null && ret > 0) wins++;
    cumPnl += pnl;
    if (ret !== null) { sumReturn += ret; validReturn++; }

    // byStock
    const code = r.code || '';
    if (code) {
      if (!byStock[code]) byStock[code] = { name: r.name || '', count: 0, pnl: 0, wins: 0 };
      byStock[code].count++;
      byStock[code].pnl += pnl;
      if (ret !== null && ret > 0) byStock[code].wins++;
    }

    // byTheme — tags 배열의 각 태그에 누적
    const tags = Array.isArray(r.tags) ? r.tags : [];
    for (const tag of tags) {
      if (!tag || typeof tag !== 'string') continue;
      if (!byTheme[tag]) byTheme[tag] = { count: 0, pnl: 0, wins: 0 };
      byTheme[tag].count++;
      byTheme[tag].pnl += pnl;
      if (ret !== null && ret > 0) byTheme[tag].wins++;
    }

    // byHoldPeriod
    const holdDays = Number.isFinite(r.holdDays) ? Math.max(0, Math.floor(r.holdDays)) : 0;
    const bucket = holdDays === 0 ? '0' : holdDays === 1 ? '1' : holdDays <= 4 ? '2-4' : '5+';
    byHoldPeriod[bucket].count++;
    byHoldPeriod[bucket].pnl += pnl;
  }

  // byStock: winRate 계산 후 wins 필드 제거
  for (const code of Object.keys(byStock)) {
    const s = byStock[code];
    s.winRate = s.count > 0 ? s.wins / s.count : 0;
    delete s.wins;
  }

  // byTheme: winRate 계산 후 wins 필드 제거
  for (const tag of Object.keys(byTheme)) {
    const t = byTheme[tag];
    t.winRate = t.count > 0 ? t.wins / t.count : 0;
    delete t.wins;
  }

  return {
    // 승률 = 수익 건 / 청산(returnPct 존재) 건. 미청산(매도 안 한) 행은 분모에서 제외 (AC-11).
    winRate: validReturn > 0 ? wins / validReturn : 0,
    cumPnl,
    avgReturn: validReturn > 0 ? sumReturn / validReturn : 0,
    tradeCount: records.length,
    byTheme,
    byStock,
    byHoldPeriod,
  };
}
