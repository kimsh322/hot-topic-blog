# 매일 핫토픽 자동 요약 블로그

## 프로젝트 개요

매일 아침 AI가 자동으로 한국 뉴스 + 글로벌 IT/테크 핫토픽 5개를 선정하고, 관련 기사를 수집·요약(한국어)하여 뉴스레터 스타일 블로그에 게시하는 서비스.

**기술 스택**: Next.js 16.2.1 (App Router, 프론트엔드 전용) + Supabase (DB + Edge Function + pg_cron) + Claude API (web search) + Vercel Hobby

---

## 시스템 아키텍처

```
[Supabase pg_cron]
  매일 07:00 KST
       │  pg_net.http_post()
       ▼
[Supabase Edge Function: generate-topics]
  │  1. 전일 토픽 조회 (중복 방지)
  │  2. Claude API + web_search → 토픽 5개 선정
  │  3. Zod 검증 & 재시도 (최대 3회)
  │  4. Claude API + web_search → 토픽별 상세 요약
  │  5. DB 저장 (upsert)
  │  6. pipeline_logs 기록
       │
       ▼
[Supabase DB]
       │
       ▼
[Next.js on Vercel]  ← DB 읽기만, 순수 프론트엔드
  /                 오늘의 핫토픽 (ISR)
  /archive          날짜별 아카이브 (ISR)
  /archive/[date]   특정 날짜 상세 (ISR)
  /og               OG 이미지 자동 생성
  /sitemap.xml      사이트맵 자동 생성
```

**Next.js에 API Route 없음.** 파이프라인 로직은 전부 Supabase Edge Function에서 처리하고, Next.js는 DB를 읽어서 렌더링하는 역할만 한다.

---

## 1. 데이터 파이프라인

### 1-1. 크론 트리거

- **시간**: 매일 오전 7:00 (KST) = UTC 22:00
- **방법**: Supabase pg_cron + pg_net (Edge Function 직접 호출)
- **엔드포인트**: Supabase Edge Function `generate-topics`
- **보안**: `SUPABASE_SERVICE_ROLE_KEY`로 인증

```sql
-- pg_cron 스케줄 등록
SELECT cron.schedule(
  'daily-hottopic-pipeline',
  '0 22 * * *',
  $$
  SELECT net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/generate-topics',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

### 1-2. 핫토픽 선정 (1차 호출)

Claude API에 `web_search` 도구를 활성화하고 (SDK 없이 fetch 직접 호출), 아래 기준으로 핫토픽 5개를 선정한다.

**선정 기준 (프롬프트에 명시)**:
- **한국 뉴스 3~4개**: 네이버 뉴스 랭킹, 다음 뉴스, 구글 트렌드 한국을 교차 확인 (정치, 경제, 사회 등)
- **글로벌 IT/테크 1~2개**: 해외 기술 뉴스, AI, 스타트업 등
- 시간 범위: 어제~오늘 아침 기준
- 중복 방지: 같은 사건의 다른 각도 기사는 1개로 통합
- 제외: 연예인 사생활, 단순 광고성 콘텐츠
- 전일 토픽 제목을 프롬프트에 포함하여 중복 제외

**응답 형식**: JSON

```json
{
  "topics": [
    {
      "title": "토픽 제목 (15자 이내)",
      "category": "카테고리",
      "keywords": ["핵심", "키워드"]
    }
  ]
}
```

**검증 로직 (Zod)**:
- topics 배열이 5개 미만이면 재검색 (최대 3회 재시도)
- 3회 시도 후에도 부족하면 있는 만큼만 저장
- Zod 스키마로 응답 형식 검증

### 1-3. 상세 요약 생성 (2차 호출)

선정된 5개 토픽에 대해 각각 관련 기사를 검색하고 요약한다.

**호출 전략**:
- 기본: 5개 토픽을 1회 호출로 묶어 처리 (비용 효율)
- 품질 저하 시: 토픽별 개별 호출로 전환 (테스트 후 결정)

**토픽별 요약 요구사항**:
- 요약 분량: 3~5문장 (200~400자)
- 어조: 객관적, 뉴스 브리핑 스타일
- 관련 기사 출처 URL 2개 이상 포함 (실제 접근 가능한 URL만)
- 핵심 수치나 인용이 있으면 포함

**응답 형식**: JSON

```json
{
  "articles": [
    {
      "title": "토픽 제목",
      "category": "경제",
      "summary": "한국어 요약 내용...",
      "sources": [
        { "title": "기사 제목", "url": "https://..." },
        { "title": "기사 제목", "url": "https://..." }
      ],
      "keywords": ["키워드1", "키워드2"]
    }
  ]
}
```

### 1-4. DB 저장

요약 결과를 Supabase에 저장한다. 저장 전 같은 날짜 데이터가 이미 있으면 삭제 후 재삽입 처리.

---

## 2. 데이터베이스 설계 (Supabase)

### 테이블: `daily_topics`

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid (PK) | 자동 생성 |
| `date` | date | 게시 날짜 (unique 제약 조건 with topic_order) |
| `topic_order` | int2 | 토픽 순서 (1~5) |
| `title` | text | 토픽 제목 |
| `category` | text | 카테고리 (정치, 경제, 사회, IT·과학, IT·테크, 문화·스포츠) |
| `summary` | text | 요약 내용 |
| `keywords` | text[] | 키워드 배열 |
| `sources` | jsonb | 출처 기사 배열 `[{title, url}]` |
| `created_at` | timestamptz | 생성 시각 |

**인덱스**: `date` DESC (메인 목록 조회 최적화)

### 테이블: `pipeline_logs`

파이프라인 실행 로그. 디버깅 및 모니터링용.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid (PK) | 자동 생성 |
| `date` | date | 실행 날짜 |
| `status` | text | success / partial / failed |
| `topics_count` | int2 | 생성된 토픽 수 |
| `retry_count` | int2 | 재시도 횟수 |
| `error_message` | text | 에러 내용 (nullable) |
| `duration_ms` | int4 | 실행 소요 시간 |
| `created_at` | timestamptz | 실행 시각 |

### 유틸리티 함수

```sql
-- 전일 토픽 제목 조회 (중복 방지용)
CREATE OR REPLACE FUNCTION get_yesterday_titles()
RETURNS TEXT[] AS $$
  SELECT COALESCE(array_agg(title), '{}'::TEXT[])
  FROM daily_topics
  WHERE date = CURRENT_DATE - 1;
$$ LANGUAGE sql STABLE;
```

### RLS (Row Level Security)

- `daily_topics`: 읽기는 전체 공개 (anon), 쓰기는 service_role만 허용
- `pipeline_logs`: 읽기/쓰기 모두 service_role만 허용

---

## 3. Supabase Edge Function

파이프라인 전체 실행. pg_cron에 의해 호출됨.

- **인증**: `Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY}`
- **런타임**: Deno (Supabase Edge Function)
- **타임아웃**: 최대 400초
- **Claude API**: SDK 없이 fetch 직접 호출, `web_search_20250305` 도구 활성화
- **검증**: Zod 스키마로 Claude 응답 파싱
- **처리 흐름**:
  1. 인증 검증
  2. 전일 토픽 조회 (중복 방지)
  3. Claude API 1차 호출 (토픽 선정)
  4. Zod 검증 → 부족 시 재시도 (최대 3회)
  5. Claude API 2차 호출 (상세 요약)
  6. 기존 데이터 삭제 후 DB 삽입
  7. pipeline_logs 기록
- **응답**: `{ status: "success" | "partial" | "failed", topicsCount: 5 }`

### Edge Function 디렉토리 구조

```
supabase/
└── functions/
    └── generate-topics/
        ├── index.ts           # 엔트리포인트
        ├── claude.ts          # Claude API 호출 (fetch)
        ├── prompts.ts         # 프롬프트 템플릿
        ├── schemas.ts         # Zod 검증 스키마
        ├── pipeline.ts        # 파이프라인 오케스트레이터
        └── retry.ts           # 재시도 로직
```

---

## 4. 프론트엔드 (블로그)

### 페이지 구성

| 경로 | 설명 | 렌더링 방식 |
|---|---|---|
| `/` | 오늘의 핫토픽 5개 표시 | ISR (1시간 재검증) |
| `/archive` | 날짜별 아카이브 목록 | ISR (24시간) |
| `/archive/[date]` | 특정 날짜 핫토픽 | ISR (24시간) |
| `/og` | OG 이미지 동적 생성 | Route Handler |
| `/sitemap.xml` | 사이트맵 자동 생성 | - |

### 메인 페이지 (`/`) UI 구성 — 뉴스레터 스타일

```
┌─────────────────────────────────────────────┐
│                                             │
│    오늘의 핫토픽                              │
│    2026년 3월 27일 금요일                     │
│    AI가 매일 아침 선정하는 뉴스 브리핑          │
│                                             │
│    ─────────────────────────────────────     │
│                                             │
│    01                                       │
│    경제  한국은행 기준금리 동결                 │
│                                             │
│    요약 텍스트 3~5줄. 객관적 뉴스 브리핑        │
│    어조로 작성된 내용이 들어갑니다.              │
│    핵심 수치나 인용이 포함될 수 있습니다.        │
│                                             │
│    출처  조선일보 · 한경 · 연합뉴스            │
│                                             │
│    ─────────────────────────────────────     │
│                                             │
│    02                                       │
│    IT·테크  OpenAI, GPT-5 공개               │
│    ...                                      │
│                                             │
│    ─────────────────────────────────────     │
│                                             │
│    ← 어제 핫토픽          아카이브 보기 →      │
│                                             │
└─────────────────────────────────────────────┘
```

### 디자인 방향

- **뉴스레터 스타일**: 최대 너비 640px 중앙 정렬 (이메일 뉴스레터와 동일한 가독성)
- **서체**: 시스템 세리프 또는 Noto Serif KR (본문), 산세리프 (카테고리 배지)
- **색상**: 따뜻한 뉴트럴 계열 (stone/warm gray), 카테고리별 포인트 컬러
- **번호 표기**: 01~05 큰 숫자로 시각적 앵커
- **구분선**: 얇은 수평선으로 토픽 사이 구분
- **여백**: 넉넉한 상하 패딩으로 콘텐츠 간 호흡
- 카테고리별 컬러 태그 (정치=red, 경제=blue, 사회=amber, IT계열=violet, 문화·스포츠=emerald)
- 모바일 퍼스트 반응형 (단일 컬럼)
- 다크모드 지원
- 출처 링크는 새 탭으로 열기

### SEO 최적화

- 동적 메타태그 (날짜별 title, description)
- OG 이미지 자동 생성 (`/og?date=YYYY-MM-DD`)
- JSON-LD 구조화 데이터 (`NewsArticle` 타입)
- sitemap.xml 자동 생성

---

## 5. 환경변수

### Next.js (Vercel)

| 변수명 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 공개 키 (읽기 전용) |

### Supabase Edge Function (Secrets)

| 변수명 | 용도 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API 인증 |

> `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Edge Function에서 자동 주입.

---

## 6. 프로젝트 구조

```
app/
├── layout.tsx                    # 루트 레이아웃 + 전역 메타데이터
├── page.tsx                      # 메인: 오늘의 핫토픽
├── archive/
│   ├── page.tsx                  # 아카이브 목록
│   └── [date]/
│       └── page.tsx              # 특정 날짜 상세
├── og/
│   └── route.tsx                 # OG 이미지 동적 생성
└── sitemap.ts                    # sitemap.xml 자동 생성

lib/
├── supabase.ts                   # Supabase 클라이언트 (anon key, 읽기 전용)
├── queries.ts                    # 데이터 조회 함수
└── types.ts                      # 공유 타입 정의

components/
├── TopicCard.tsx                 # 토픽 카드
├── CategoryBadge.tsx             # 카테고리 태그
├── SourceLinks.tsx               # 출처 링크 목록
├── DateNav.tsx                   # 날짜 네비게이션
├── NewsletterHeader.tsx          # 뉴스레터 스타일 헤더
└── TopicSkeleton.tsx             # 로딩 스켈레톤

supabase/
└── functions/
    └── generate-topics/          # Edge Function (파이프라인)
        ├── index.ts
        ├── claude.ts
        ├── prompts.ts
        ├── schemas.ts
        ├── pipeline.ts
        └── retry.ts

vercel.json                       # Vercel 설정 (크론 없음)
```

---

## 7. 작업 순서 (마일스톤)

### Phase 1 — 파이프라인 구축 (핵심)
1. Supabase 테이블, RLS, 유틸리티 함수 생성 (Supabase MCP 활용)
2. Edge Function 작성 (generate-topics)
3. Claude 프롬프트 작성 및 테스트 (수동 호출)
4. Zod 스키마 검증, 재시도 로직 확인
5. pg_cron + pg_net 스케줄 등록
6. 며칠간 자동 실행 모니터링 (pipeline_logs 확인)

### Phase 2 — 블로그 프론트엔드
7. Next.js 프로젝트에 Supabase 연동
8. 메인 페이지 (뉴스레터 스타일)
9. 아카이브 페이지
10. 반응형 + 다크모드 스타일링
11. SEO: 메타태그, OG 이미지, JSON-LD, sitemap.xml

### Phase 3 — 테스트 & 배포
12. Playwright E2E 테스트 작성
13. Vercel 배포 + 환경변수 설정
14. GitHub Actions CI 파이프라인 설정
15. 프롬프트 품질 튜닝

### Phase 4 — 개선 (선택)
- RSS 피드 생성
- 뉴스레터 이메일 발송 (Resend)
- 검색 기능 (Supabase Full Text Search)
- 주간 하이라이트 자동 생성

---

## 8. 비용 추정 (월간)

| 항목 | 예상 비용 |
|---|---|
| Vercel Hobby | 무료 (프론트엔드만) |
| Supabase Free tier (500MB DB, Edge Functions 포함) | 무료 |
| Claude API Sonnet (일 2회 호출 × 30일) | ~$3~8/월 |
| **합계** | **~$3~8/월** |

---

## 9. 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| Claude 웹 검색 결과 부실 | 재시도 3회 + 프롬프트에 구체적 소스 앵커 명시 |
| Edge Function 400초 초과 | 토픽 선정/요약을 별도 Function으로 분리 |
| 토픽 품질 불균일 | 프롬프트 반복 튜닝, 한국/글로벌 비율 조건 강화 |
| 같은 토픽 연일 반복 | 전일 토픽을 프롬프트에 포함하여 제외 |
| 출처 URL 깨짐 (404) | 향후 URL HEAD 요청 검증 추가 (P2) |
| pg_cron 실행 누락 | pipeline_logs 테이블에서 주기적 확인 |
