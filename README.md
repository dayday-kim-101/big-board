# 주식 전광판 (Stock Big Board)

이메일만 입력하면 어디서든 접속하는 개인용 주식 전광판. 한국·미국 종목을 그룹/탭으로 정리하고, 종목명·현재가·등락폭·등락률·거래량·거래대금을 한국식 색(상승🔴/하락🔵) 격자로 본다. 최대 5명이 각자 자기 종목판을 갖고 완전 무료로 운영한다.

## 구조

- **프론트엔드**: 정적 사이트 (`public/`) — Cloudflare Pages
- **백엔드**: Pages Functions (`functions/api/`)
  - `quotes.js` — Yahoo/네이버 시세 프록시
  - `list.js` — GitHub 저장소 기반 이메일별 종목 목록 read/write
- **데이터**: GitHub 저장소 — 별도 DB 없음
  - `data/users/<hash>.json` — 이메일별 종목·그룹 (비공개, `/api/list`로만 접근)
  - `public/data/prices/latest.json` — 가격 스냅샷 (Pages가 정적 서빙)
- **스냅샷**: GitHub Action(`.github/workflows/snapshot.yml`)이 주기적으로 가격 수집·커밋

## 로컬 개발

```bash
npm install
cp .dev.vars.example .dev.vars   # 토큰 등 채우기
npm run dev                      # wrangler pages dev
```

### 필요한 환경변수 (`.dev.vars` / Cloudflare secret)

| 변수 | 설명 |
|---|---|
| `GITHUB_TOKEN` | 데이터 저장소 contents 권한 fine-grained PAT |
| `GITHUB_REPO` | `owner/repo` (데이터 저장소) |
| `GITHUB_BRANCH` | 데이터 브랜치 (기본 `main`) |

## 배포 (Cloudflare Pages + GitHub)

완전 무료로 라이브에 올리는 절차. 한 번만 설정하면 이후엔 push만으로 자동 배포됩니다.

### 1. GitHub 저장소 생성 + push

코드와 데이터(`data/users/`, `public/data/prices/`)가 같은 저장소에 있습니다.

```bash
git remote add origin https://github.com/<owner>/<repo>.git
git push -u origin main        # 또는 현재 브랜치를 main에 병합 후 push
```

### 2. fine-grained PAT 발급

GitHub → *Settings → Developer settings → Personal access tokens → Fine-grained tokens*

- **Repository access**: 위에서 만든 저장소 1개만 선택
- **Permissions**: *Contents → Read and write* (이것만)
- 발급된 토큰을 복사 (3단계에서 사용)

> 이 토큰은 사이트 코드에 절대 넣지 않습니다. Cloudflare Secret으로만 주입되어 서버(Function) 쪽에 숨겨집니다.

### 3. Cloudflare Pages 연결

Cloudflare 대시보드 → *Workers & Pages → Create → Pages → Connect to Git*

- 위 저장소 선택
- **Build command**: 비움 (정적 + Functions 자동 감지)
- **Build output directory**: `public`
- 배포 후 `https://<project>.pages.dev` 주소가 생성됨

### 4. Pages 환경변수(Secret) 설정

프로젝트 → *Settings → Environment variables*에 추가 (Production + Preview):

| 변수 | 값 |
|---|---|
| `GITHUB_TOKEN` | 2단계에서 발급한 PAT |
| `GITHUB_REPO` | `owner/repo` (데이터 저장소) |
| `GITHUB_BRANCH` | `main` |

저장 후 재배포(Retry deployment)하면 `/api/list`가 동작합니다.

### 5. 가격 스냅샷 Action 활성화

`.github/workflows/snapshot.yml`이 평일 장중에 가격을 받아 `public/data/prices/latest.json`에 커밋합니다.

- GitHub 저장소 → *Settings → Actions → General* → Workflow permissions를 **Read and write**로 설정 (워크플로에 `permissions: contents: write`도 명시돼 있음)
- *Actions* 탭에서 **가격 스냅샷** 워크플로를 한 번 수동 실행(*Run workflow*)해 동작 확인
- 스냅샷 커밋이 push되면 Cloudflare가 자동 재배포 → 최신 가격 반영

> GitHub 스케줄은 분 단위 정밀도가 낮아 ±수분 지연될 수 있습니다. 즉시성이 필요하면 화면의 **↻ 새로고침** 버튼을 쓰세요(실시간 프록시 호출).

### 6. 확인

배포된 주소 접속 → 이메일 입력 → 그룹 생성 → 종목 추가(KR `005930` / US `AAPL`) → 다른 기기에서 같은 이메일로 동기화 확인 → 새로고침으로 실시간 시세 갱신.

> **보안 메모**: 이메일은 비밀번호 없는 약한 식별 키입니다(5명 신뢰 그룹 전제). 남의 이메일을 알면 그 목록을 볼 수 있으니, 신뢰하는 사람끼리만 공유하세요.

## 테스트

```bash
npm test    # node --test
```

## 문서

- 요구사항: `docs/brainstorms/2026-05-31-stock-bigboard-requirements.md`
- 구현 계획: `docs/plans/2026-05-31-001-feat-stock-bigboard-plan.md`
