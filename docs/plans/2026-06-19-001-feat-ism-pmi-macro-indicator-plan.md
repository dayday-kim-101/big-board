---
type: feat
status: completed
created: 2026-06-19
title: "feat: 매크로 지표탭에 ISM PMI 추가 (제조업·서비스업, 50=침체 기준선)"
---

# feat: 매크로 지표탭에 ISM PMI 추가 (제조업·서비스업, 50=침체 기준선)

## Summary

매크로 지표탭(`매크로 지표`)에 **ISM PMI** 지표를 추가한다. 제조업 PMI와 서비스업(비제조업) PMI 두 시리즈를 한 카드에 라인으로 표시하고, **50 미만은 경기 침체 신호**로 강조한다.

침체 신호는 세 곳에서 드러낸다(사용자 확정):
1. **카드 배지** — 최신값이 50 미만인 시리즈가 하나라도 있으면 카드 헤더에 `침체 신호` 배지.
2. **카드 색상** — 50 미만 시리즈의 값/행을 침체 톤(한국식 하락=파랑)으로, 카드에 경고 테두리 톤.
3. **차트 기준선** — 차트 모달에 50 수평 기준선(점선).

기존 DXY 봉차트와 같은 데이터 파이프라인(수집 스크립트 → `macro.json` 정적 서빙 → 프런트 렌더)을 그대로 따른다. ISM은 가격 시계열이 아닌 월별 레벨 지표이므로, 기존의 **다중 라인차트 경로**(2개 시리즈)에 자연스럽게 올라탄다.

---

## Problem Frame

- **무엇:** ISM PMI(제조업·서비스업)를 매크로 지표탭에 추가하고, 50 기준 침체 신호를 시각화한다.
- **왜:** ISM PMI는 미국 경기선행지표의 대표격이며, 50선이 확장/수축의 분기점이다. 사용자는 한눈에 침체 진입 여부를 보고 싶어 한다.
- **현 상태:** 매크로 탭에는 DXY(봉차트), 미국 기준금리, 한국 외환보유액/대외채무/단기외채가 있다. 어떤 지표에도 "기준선/임계값" 개념이 없다 — 이번에 임계값(threshold) 메타를 처음 도입한다.

### 데이터 소스 결정 (핵심)

FRED는 ISM 시리즈를 **2016년에 전량 삭제**했다(ISM이 재배포 권한 회수 — NAPM 등 discontinued). 따라서 이 레포가 이미 쓰는 FRED로는 ISM을 받을 수 없다. 대신 **DBnomics**(무인증 공개 JSON API)가 ISM를 집계해 제공한다 — 기존의 "공개 API에서 시계열 수집" 패턴에 그대로 부합한다.

| 항목 | 값 |
|---|---|
| 제조업 PMI | `ISM/pmi/pm` (월별) |
| 서비스업 PMI | `ISM/nm-pmi/pm` (월별) |
| 엔드포인트 | `https://api.db.nomics.world/v22/series/{provider}/{dataset}/{series}?observations=1&format=json` |
| 인증 | 불필요 |
| 관측치 경로 | `series.docs[0]` → 병렬 배열 `period`("YYYY-MM"), `period_start_day`("YYYY-MM-01"), `value`(number, 결측은 `null`/`"NA"` 방어 필요) |

> 참고: DBnomics는 소스 갱신을 약간 지연 반영할 수 있다(월별 지표라 영향 작음). 출처 표기는 `ISM / DBnomics`로 한다.

Sources: [Wikipedia — ISM Report On Business](https://en.wikipedia.org/wiki/ISM_Report_On_Business), [DBnomics ISM/pmi](https://db.nomics.world/ISM/pmi)

---

## Scope Boundaries

**In scope**
- DBnomics 시리즈 파서 + fetch 래퍼(`_macro-core.js`)
- 지표 정규화에 선택적 `threshold` 메타 통과(passthrough)
- 수집 스크립트에 `ism` 지표(2개 시리즈) 추가
- 카드 침체 신호(배지 + 색상)와 차트 50 기준선
- 위 각 단위의 테스트

**Out of scope / 비목표**
- 다른 지표(DXY·금리·외환)의 동작 변경
- ISM 세부 하위지수(신규주문·고용·물가 등) — 헤드라인 PMI만
- 침체 임계값 사용자 설정(UI 토글) — 50 고정
- 알림/푸시, 과거 침체구간 음영 등 고급 시각화

### Deferred to Follow-Up Work
- ISM 세부 하위지수 추가(DBnomics에 `neword`, `employment`, `prices` 등 존재)
- 침체 구간 배경 음영(차트) — 기준선만으로 충분하면 불필요

---

## Key Technical Decisions

1. **데이터 소스: DBnomics** — FRED는 ISM 미제공(2016 삭제). DBnomics는 무인증·JSON·기존 패턴 호환. API 키 추가 불필요(워크플로 시크릿 변경 없음).
2. **한 카드 2시리즈 → 라인차트** — ISM은 OHLC가 아닌 월별 레벨값. 기존 `macro-chart.js`의 `singleOHLC=false` 다중 라인 경로를 그대로 사용. 범례 자동 표시(시리즈 2개).
3. **임계값을 데이터 메타로 통과** — 지표 config에 `threshold: { value: 50, belowIsBad: true, label: '침체' }`를 두고 `normalizeIndicator`가 선택적으로 보존 → `macro.json` → 프런트가 `ind.threshold`로 읽음. 프런트에 50을 하드코딩하지 않아 향후 다른 임계 지표에 재사용 가능.
4. **침체 판정은 순수 헬퍼로** — `belowThreshold(value, threshold)`를 `macro.js`에 두고 카드·행 양쪽에서 사용(테스트 용이).
5. **차트 기준선은 lightweight-charts `createPriceLine`** — 시리즈 생성 직후 `ind.threshold` 있으면 첫 시리즈에 50 점선 추가. 두 라인이 같은 가격축을 공유하므로 1개면 충분.
6. **소수 1자리** — PMI는 소수 1자리 표기(`decimals: 1`), 단위 없음.

---

## High-Level Technical Design

> 아래는 방향 제시용 스케치이며 구현 명세가 아니다. 구현 에이전트는 맥락으로만 참고할 것.

```
DBnomics (ISM/pmi/pm, ISM/nm-pmi/pm)
        │  fetchDbnomicsSeries()  ← 무인증
        ▼
parseDbnomicsSeries(json)  → [{date:'YYYY-MM-01', value}]  (오름차순, 결측 제외)
        ▼
INDICATORS[ism] (제조업·서비스업 2 series, threshold:{value:50,...})
        │  scripts/macro-snapshot.mjs (CI: 평일 1회)
        ▼
normalizeMacro → public/data/macro/macro.json  (threshold 보존)
        ▼
renderMacro → indicatorCard
        ├─ seriesRow: 최신값<50 → 침체 톤 + '침체' 태그
        └─ card: any<50 → .macro-card-warn + 헤더 '침체 신호' 배지
        ▼ (클릭)
openMacroChart → macroChart (2-line)
        └─ ensureChart: ind.threshold → lwSeries[0].createPriceLine(50, 점선)
```

침체 판정 매트릭스:

| 제조업 최신 | 서비스업 최신 | 카드 배지/색상 |
|---|---|---|
| ≥50 | ≥50 | 없음(정상) |
| <50 | ≥50 | 침체 신호(제조업 행만 침체 톤) |
| ≥50 | <50 | 침체 신호(서비스업 행만 침체 톤) |
| <50 | <50 | 침체 신호(두 행 모두 침체 톤) |

---

## Implementation Units

### U1. DBnomics 파서 + fetch 래퍼

**Goal:** DBnomics 시리즈 JSON을 오름차순 `{date,value}` 포인트로 변환하는 순수 파서와, 무인증 fetch 래퍼를 추가한다.

**Requirements:** 데이터 소스 결정(Problem Frame), KTD #1.

**Dependencies:** 없음.

**Files:**
- `functions/api/_macro-core.js` (수정 — `parseDbnomicsSeries`, `fetchDbnomicsSeries` 추가)
- `scripts/macro-snapshot.test.js` (수정 — 파서 테스트 추가)

**Approach:**
- `parseDbnomicsSeries(json)`: `json.series.docs[0]`에서 `period_start_day`(없으면 `period`+`'-01'`)와 `value` 병렬 배열을 짝지어 포인트 생성. `value`가 숫자가 아닌 항목(`null`, `"NA"`, 결측)은 기존 `num()` 가드로 제외. 날짜 정규식 `^\d{4}-\d{2}-\d{2}$` 통과만. 오름차순 정렬. `docs`가 비었거나 형식 오류면 throw(다른 파서들과 동일한 실패 시맨틱).
- `fetchDbnomicsSeries(provider, dataset, series)`: 기존 `fetchJson` 래퍼 재사용. URL `https://api.db.nomics.world/v22/series/${provider}/${dataset}/${series}?observations=1&format=json`. 반환값에 `parseDbnomicsSeries` 적용 후 오름차순 정렬.
- 기존 `num()`/`isNum()` 헬퍼와 파일 상단 주석의 "데이터 소스" 목록에 DBnomics 한 줄 추가.

**Patterns to follow:** 같은 파일의 `parseFredObservations`(결측 제외·throw 시맨틱), `fetchFredSeries`(fetch→parse→sort 형태).

**Test scenarios (`scripts/macro-snapshot.test.js`):**
- `parseDbnomicsSeries`: 정상 docs(period_start_day + value 배열) → 오름차순 `{date,value}` 포인트. 입력이 비정렬이어도 오름차순으로 정렬됨.
- `parseDbnomicsSeries`: `value`에 `null`/`"NA"`/비숫자가 섞이면 해당 포인트 제외, 짝 맞는 유효 포인트만 남김.
- `parseDbnomicsSeries`: `period_start_day` 없이 `period`("YYYY-MM")만 있을 때 → `"YYYY-MM-01"`로 변환.
- `parseDbnomicsSeries`: `series.docs`가 없거나 빈 배열 → throw('DBnomics 응답 형식 오류' 류).

**Verification:** 새 테스트 통과(`npm test`). `node -e`로 `parseDbnomicsSeries`에 샘플 JSON을 넣어 포인트 배열이 나오는지 확인.

---

### U2. 임계값 메타 통과 + ISM 지표 정의

**Goal:** 지표 정규화가 선택적 `threshold`를 보존하게 하고, 수집 스크립트에 ISM 지표(제조업·서비스업)를 추가한다.

**Requirements:** KTD #3, KTD #6. Summary의 2시리즈 카드.

**Dependencies:** U1(fetch 래퍼 사용).

**Files:**
- `functions/api/_macro-core.js` (수정 — `normalizeIndicator`에 `threshold` 선택 통과)
- `scripts/macro-snapshot.mjs` (수정 — `INDICATORS`에 `ism` 추가, import에 `fetchDbnomicsSeries`)
- `scripts/macro-snapshot.test.js` (수정 — threshold 통과 테스트)
- `public/data/macro/macro.json` (수집 스크립트 1회 실행으로 ism 시드 — 검증 단계 산출물)

**Approach:**
- `normalizeIndicator`: 반환 객체에 `...(ind?.threshold ? { threshold: { value: num(ind.threshold.value), belowIsBad: ind.threshold.belowIsBad !== false, label: String(ind.threshold.label ?? '') } } : {})` 형태로 **있을 때만** 추가. 임계값 없는 기존 지표는 객체 형태 불변(스냅샷/테스트 영향 없음).
- `INDICATORS`에 추가:
  - `key: 'ism'`, `label: 'ISM PMI'`, `unit: ''`, `decimals: 1`, `source: 'ISM / DBnomics'`
  - `threshold: { value: 50, belowIsBad: true, label: '침체' }`
  - `series`: `{ name: '제조업', maxPoints: 120, fetch: () => fetchDbnomicsSeries('ISM','pmi','pm') }`, `{ name: '서비스업', maxPoints: 120, fetch: () => fetchDbnomicsSeries('ISM','nm-pmi','pm') }`
- ISM은 무인증이므로 API 키 게이트 없음. 한 시리즈 실패 시 기존 폴백(이전 값 유지) 로직이 그대로 적용됨.

**Patterns to follow:** 같은 파일 `normalizeIndicator`의 필드별 정규화. `INDICATORS`의 dxy 항목(`maxPoints`, `fetch` 클로저 형태).

**Test scenarios (`scripts/macro-snapshot.test.js`):**
- `normalizeIndicator`: `threshold` 있으면 정규화 결과에 `{value:50, belowIsBad:true, label:'침체'}` 보존.
- `normalizeIndicator`: `threshold` 없으면 결과 객체에 `threshold` 키 자체가 없음(기존 지표 회귀 방지).
- `normalizeIndicator`: `threshold.belowIsBad` 생략 시 기본 `true`.

**Execution note:** 정규화 회귀가 위험하므로 threshold-없음 케이스 테스트를 먼저 작성(기존 지표 불변 보장).

**Verification:** `npm test` 통과. `node scripts/macro-snapshot.mjs` 로컬 1회 실행 → `macro.json`에 `ism` 지표(제조업·서비스업 포인트 + `threshold`) 생성 확인(FRED/ECOS 키 없어도 ISM은 DBnomics라 채워짐, 나머지는 기존값 유지).

---

### U3. 카드 침체 신호 (배지 + 색상)

**Goal:** 카드/시리즈 행에서 최신값 50 미만을 침체 신호로 표시한다 — 헤더 배지, 행 침체 톤, 카드 경고 톤.

**Requirements:** 침체 신호 표현(사용자 확정: 카드 색상 + 배지). KTD #4.

**Dependencies:** U2(데이터에 `threshold` 존재).

**Files:**
- `public/js/macro.js` (수정 — `belowThreshold` 헬퍼, `seriesRow`/`indicatorCard`에 침체 표시)
- `public/css/board.css` (수정 — `.macro-card-warn`, 침체 배지/태그 스타일)
- `public/js/macro.dom.test.js` (수정 — 침체 표시 테스트)

**Approach:**
- 순수 헬퍼 `belowThreshold(value, threshold)`: `isNum(value) && threshold && threshold.belowIsBad && value < threshold.value` → boolean. export(테스트 대상).
- `seriesRow(series, unit, decimals, threshold)`: 최신값이 `belowThreshold`면 값 텍스트에 침체 톤 클래스(한국식 하락=파랑, 기존 `down` 톤 재사용) + 작은 `침체` 태그(`macro-stag`) 추가. 그 외엔 기존과 동일.
- `indicatorCard`: 시리즈 중 하나라도 최신값이 `belowThreshold`면 카드에 `macro-card-warn` 클래스 추가, 헤더(`macro-card-head`)에 `침체 신호` 배지(`macro-badge-warn`) 삽입. `ind.threshold`를 `seriesRow`에 전달.
- CSS: `.macro-card-warn`은 경고 테두리/배경 틴트(과하지 않게, 기존 `--line`/톤 변수 활용). `.macro-badge-warn`는 작은 알약형 라벨, `.macro-stag`는 행 내 소형 태그. 한국식 하락=파랑(`board.css`의 기존 down 색상 변수와 일관).

**Patterns to follow:** `macro.js`의 기존 순수 헬퍼(`changeOf`, `changeTone`) 스타일과 export 관례. `seriesRow`의 `macro-schange ${changeTone(chg)}` 톤 부여 방식. `board.css`의 `.macro-*` 클래스 네이밍.

**Test scenarios (`public/js/macro.dom.test.js`):**
- `belowThreshold`: 값<임계 → true; 값≥임계 → false; `threshold` 없음 → false; `belowIsBad:false`면 → false; 값이 비숫자 → false.
- `renderMacro`(침체 카드): 제조업 최신<50인 데이터 → 카드에 `macro-card-warn` 클래스 + `침체 신호` 배지 텍스트 존재.
- `renderMacro`(정상 카드): 두 시리즈 모두 ≥50 → `macro-card-warn` 없음, 배지 없음.
- `renderMacro`(부분 침체): 제조업<50, 서비스업≥50 → 카드 배지 존재하고, 제조업 행에만 `macro-stag`/침체 톤.
- 회귀: `threshold` 없는 기존 지표(예: 금리) → 침체 표시 전혀 없음.

**Verification:** `npm test` 통과. (필요 시) `public/index.html` 로컬 서빙으로 매크로 탭에서 ISM 카드 배지/색상 육안 확인.

---

### U4. 차트 50 기준선

**Goal:** 매크로 차트 모달에서 `threshold` 있는 지표에 50 수평 기준선(점선)을 그린다.

**Requirements:** 침체 신호 표현 중 "차트선". KTD #5.

**Dependencies:** U2(`ind.threshold` 존재). U3와 병행 가능.

**Files:**
- `public/js/macro-chart.js` (수정 — `ensureChart`에서 `createPriceLine`)

**Approach:**
- `ensureChart()`에서 시리즈 생성(`lwSeries`) 직후, `ind.threshold`가 있으면 `lwSeries[0].createPriceLine({ price: ind.threshold.value, color, lineStyle: <Dashed>, lineWidth: 1, axisLabelVisible: true, title: \`${ind.threshold.label} ${ind.threshold.value}\` })` 호출. 색상은 중립/경고 톤(기존 `DOWN`/회색 계열) 사용.
- 다중 라인 모두 같은 우측 가격축 공유 → 기준선 1개로 충분. `singleOHLC` 봉차트 경로에도 동일 패턴 적용 가능하나 이번 ISM은 라인 경로.
- `wrap._cleanup`은 `chart.remove()`가 priceLine까지 정리하므로 추가 작업 불필요.

**Patterns to follow:** `macro-chart.js`의 `ensureChart` 내 시리즈 생성 흐름과 `UP`/`DOWN`/`LINE_COLORS` 상수 사용.

**Test scenarios:** `Test expectation: none — lightweight-charts CDN(lazy import) + DOM 의존으로 단위테스트 대상 아님(기존 `macro-chart.js`도 미커버).` 대신 검증으로 대체: 모달에서 50 점선과 축 라벨이 보이는지, `threshold` 없는 지표(금리 등) 모달에는 기준선이 없는지 육안 확인.

**Verification:** 로컬 서빙 → ISM 카드 클릭 → 차트에 50 점선 + 라벨 표시. 다른 지표 모달엔 기준선 없음. 콘솔 에러 없음.

---

## System-Wide Impact

- **데이터 스키마(`macro.json`):** 지표에 선택적 `threshold` 필드 신설. 하위호환(없으면 기존과 동일). DXY 등 기존 지표 불변.
- **CI 워크플로(`.github/workflows/macro-snapshot.yml`):** 변경 없음 — DBnomics는 무인증이라 새 시크릿 불필요. 수집 시간/커밋 단계 그대로.
- **프런트 계약:** `seriesRow` 시그니처에 `threshold` 인자 추가(내부 호출만, 외부 영향 없음). `belowThreshold` 신규 export.
- **사용자:** 매크로 탭에 카드 1개 추가, 50 미만 시 침체 시각 신호.

---

## Risks & Mitigations

| 리스크 | 영향 | 완화 |
|---|---|---|
| DBnomics 응답 스키마/경로 변동 | ISM 수집 실패 | 파서가 throw → 기존 폴백(이전 값 유지) 동작. `source` 표기로 출처 추적 |
| DBnomics 갱신 지연 | 최신월 1~N개월 늦음 | 월별 저빈도 지표라 허용. 기준일(`기준일 YYYY-MM-01`) 표시로 투명화 |
| `value` 결측 표현이 `null`/`"NA"`/문자열로 다양 | 잘못된 포인트 | `num()` 가드로 비숫자 일괄 제외(U1 테스트로 고정) |
| 정규화 `threshold` 통과가 기존 지표에 영향 | 회귀 | threshold-없음 케이스 테스트 우선 작성(U2) |
| 침체 색상이 한국식 톤과 충돌 | UX 혼란 | 하락=파랑 기존 변수 재사용, 배지/태그로 의미 보강 |

---

## Verification Strategy

1. `npm test` — U1·U2·U3 신규/회귀 테스트 전부 통과.
2. `node scripts/macro-snapshot.mjs` 로컬 실행 → `macro.json`에 `ism`(제조업·서비스업 포인트 + `threshold`) 생성, 다른 지표 기존값 유지.
3. 로컬 서빙으로 매크로 탭 육안 확인:
   - ISM 카드: 두 시리즈 라인, 최신값/전기대비/기준일.
   - 최신값<50이면 `침체 신호` 배지 + 침체 톤.
   - 카드 클릭 → 차트 모달에 50 점선 기준선 + 일/주/월/연봉 토글 정상.
   - 금리 등 기존 지표 모달엔 기준선/침체 표시 없음(회귀 없음).
