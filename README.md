# 오늘의 핫토픽 — AI 뉴스 브리핑

매일 아침 네이버 뉴스 1000건을 분석하여 핫토픽 5개를 자동 선정하고, AI가 요약하는 뉴스레터 스타일 블로그.

**https://hot-topic-blog.vercel.app**

## 작동 방식

```
매일 07:00 KST (pg_cron)
    │
    ▼
네이버 뉴스 API × 10회 → 1000건 수집
    │
    ▼
키워드 조합 빈도 분석 → 핫토픽 후보 10개
    │
    ▼
Claude API → 카테고리 분산하여 5개 선정 + 한국어 요약
    │
    ▼
Supabase DB 저장 → Next.js로 렌더링
```

## 기술 스택

| 레이어 | 기술 |
|---|---|
| 프론트엔드 | Next.js 16.2.1 (App Router), Tailwind CSS 4, Noto Serif KR |
| 백엔드 | Supabase Edge Function (Deno) |
| DB | Supabase PostgreSQL |
| 뉴스 수집 | 네이버 검색 API |
| AI 요약 | Claude API (Sonnet, web_search 미사용) |
| 스케줄러 | Supabase pg_cron + pg_net |
| 배포 | Vercel Hobby (무료) |
| 테스트 | Playwright E2E |

## 로컬 개발

```bash
pnpm install
pnpm dev
```

### 환경변수 (.env.local)

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
```

### E2E 테스트

```bash
pnpm exec playwright install
pnpm exec playwright test
```

## 프로젝트 구조

```
src/app/          페이지 (메인, 아카이브, OG 이미지, sitemap)
src/components/   UI 컴포넌트 (TopicCard, CategoryBadge 등)
src/lib/          Supabase 클라이언트, 쿼리, 타입
supabase/         Edge Function (뉴스 수집 + 분석 + 요약)
e2e/              Playwright E2E 테스트
```
