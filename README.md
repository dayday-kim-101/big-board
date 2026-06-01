# 주식 전광판 (Stock Big Board)

이메일만 입력하면 어디서든 접속하는 개인용 주식 전광판. 한국·미국 종목을 그룹/탭으로 정리하고, 종목명·현재가·등락폭·등락률·거래량·거래대금을 한국식 색(상승🔴/하락🔵) 격자로 본다. 최대 5명이 각자 자기 종목판을 갖고 완전 무료로 운영한다.

## 구조

- **프론트엔드**: 정적 사이트 (`public/`) — Cloudflare Pages
- **백엔드**: Pages Functions (`functions/api/`)
  - `quotes.js` — Yahoo/네이버 시세 프록시
  - `list.js` — GitHub 저장소 기반 이메일별 종목 목록 read/write
- **데이터**: GitHub 저장소 (`data/`) — 별도 DB 없음
  - `users/<hash>.json` — 이메일별 종목·그룹
  - `prices/latest.json` — 가격 스냅샷
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

## 테스트

```bash
npm test    # node --test
```

## 문서

- 요구사항: `docs/brainstorms/2026-05-31-stock-bigboard-requirements.md`
- 구현 계획: `docs/plans/2026-05-31-001-feat-stock-bigboard-plan.md`
