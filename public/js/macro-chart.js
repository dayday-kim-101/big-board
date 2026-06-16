// 매크로 지표 차트 모달 — DXY 등 단일 OHLC 시리즈는 봉차트, 레벨형(금리·외환보유액·외채)은
// 라인차트로 그린다. 일/주/월/연봉 토글이 일별 데이터를 집계한다(aggregateOHLC).
// lightweight-charts(CDN)를 lazy import. app.js의 종목 차트와 독립.
import { aggregateOHLC, seriesHasOHLC } from './macro.js';

const LWC_CDN = 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.mjs';
const UP = '#ff4d4f';   // 한국식 상승=빨강
const DOWN = '#4d7bff'; // 한국식 하락=파랑
const LINE_COLORS = ['#e0b341', '#4d9bff', '#36d399', '#ff6b6d'];

// 지표 클릭 → 차트 모달을 띄운다. (app.js renderMacro의 onOpenChart 콜백)
export function openMacroChart(ind) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';

  const head = document.createElement('div');
  head.className = 'modal-head';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = `${ind.label}${ind.unit ? ` (${ind.unit})` : ''}${ind.source ? ` · ${ind.source}` : ''}`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.title = '닫기';
  closeBtn.textContent = '✕';
  head.append(title, closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body';
  const content = macroChart(ind);
  body.appendChild(content);

  modal.append(head, body);
  overlay.appendChild(modal);

  const remove = () => {
    content._cleanup?.();
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') remove(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) remove(); });
  closeBtn.addEventListener('click', remove);
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  return overlay;
}

// 차트 본체. 단일 OHLC 시리즈 → 봉차트, 그 외 → 라인(시리즈별). 기간 토글이 일봉을 집계.
export function macroChart(ind) {
  const wrap = document.createElement('div');
  wrap.className = 'lw-chart';

  const legend = document.createElement('div');
  legend.className = 'chart-legend';

  const tabs = document.createElement('div');
  tabs.className = 'chart-periods';

  const box = document.createElement('div');
  box.className = 'chart-canvas';
  const status = document.createElement('div');
  status.className = 'chart-status';
  box.appendChild(status);

  const series = Array.isArray(ind?.series) ? ind.series : [];
  const decimals = Number.isFinite(ind?.decimals) ? ind.decimals : 2;
  const singleOHLC = series.length === 1 && seriesHasOHLC(series[0]);

  let chart = null, LWC = null, lwSeries = [], reqId = 0;

  async function ensureChart() {
    if (!LWC) LWC = await import(LWC_CDN);
    if (chart) return;
    chart = LWC.createChart(box, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#8b94a7' },
      grid: { vertLines: { color: 'rgba(42,51,68,.4)' }, horzLines: { color: 'rgba(42,51,68,.4)' } },
      rightPriceScale: { borderColor: '#2a3344' },
      timeScale: { borderColor: '#2a3344' },
      crosshair: { mode: LWC.CrosshairMode.Normal },
    });
    const priceFormat = { type: 'price', precision: decimals, minMove: 10 ** -decimals };
    if (singleOHLC) {
      lwSeries = [chart.addCandlestickSeries({
        upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN, priceFormat,
      })];
    } else {
      lwSeries = series.map((_, i) =>
        chart.addLineSeries({ color: LINE_COLORS[i % LINE_COLORS.length], lineWidth: 2, priceFormat }));
    }
  }

  async function load(period) {
    const myId = ++reqId;
    status.style.display = 'block';
    status.textContent = '불러오는 중…';
    try {
      await ensureChart();
      if (myId !== reqId) return;
      if (singleOHLC) {
        lwSeries[0].setData(aggregateOHLC(series[0].points, period));
      } else {
        series.forEach((s, i) => {
          const bars = aggregateOHLC(s.points, period);
          lwSeries[i].setData(bars.map((b) => ({ time: b.time, value: b.close })));
        });
      }
      chart.timeScale().fitContent();
      status.style.display = 'none';
    } catch (e) {
      status.textContent = `차트 로드 실패: ${e.message}`;
    }
  }

  // 시리즈 2개 이상이면 범례 표시
  if (!singleOHLC && series.length > 1) {
    series.forEach((s, i) => {
      const item = document.createElement('span');
      item.className = 'legend-item';
      const dot = document.createElement('span');
      dot.className = 'legend-dot';
      if (dot.style) dot.style.background = LINE_COLORS[i % LINE_COLORS.length];
      const name = document.createElement('span');
      name.textContent = s.name;
      item.append(dot, name);
      legend.appendChild(item);
    });
  }

  const PERIODS = [['D', '일봉'], ['W', '주봉'], ['M', '월봉'], ['Y', '연봉']];
  for (const [p, label] of PERIODS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chart-period';
    b.textContent = label;
    b.addEventListener('click', () => {
      tabs.querySelectorAll('.chart-period').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      load(p);
    });
    tabs.appendChild(b);
  }
  tabs.children[2].classList.add('active'); // 월봉 기본

  wrap.append(legend, tabs, box);
  load('M');

  wrap._cleanup = () => { try { chart?.remove(); } catch { /* noop */ } };
  return wrap;
}
