# 매일 핫토픽 자동 요약 블로그

## 프로젝트 개요

매일 아침 네이버 뉴스 1000건을 분석하여 핫토픽 5개를 자동 선정하고, AI가 요약하여 뉴스레터 스타일 블로그에 게시하는 서비스.

**기술 스택**: Next.js 16.2.1 (App Router, 프론트엔드 전용) + Supabase (DB + Edge Function + pg_cron) + 네이버 검색 API + Claude API (요약 전용) + Vercel Hobby

---

## 시스템 아키텍처

```
[Supabase pg_cron]
  매일 07:00 KST
       │  pg_net.http_post()
       ▼
[Supabase Edge Function: generate-topics]
  │  1. 네이버 뉴스 API × 10회 → 최신 뉴스 1000건 수집
  │  2. 키워드 조합 빈도 분석 → 핫토픽 후보 10개 자동 추출
  │  3. Claude API 1회 호출 (web_search 없음)
  │     → 카테고리당 최대 2개, 5개 선정 + 요약
  │  4. Zod 검증 & 재시도 (최대 3회)
  │  5. DB 저장
  │  6. pipeline_logs 기록
       │
       ▼
[Supabase DB]
       │
       ▼
[Next.js on Vercel]  ← DB 읽기만, 순수 프론트엔드
  /                 오늘의 핫토픽 (ISR 1일)
  /archive          날짜별 아카이브 (ISR 1일)
  /archive/[date]   특정 날짜 상세 (ISR 1일)
  /og               OG 이미지 자동 생성
  /sitemap.xml      사이트맵 자동 생성
```

**핵심 설계**: 토픽 선정은 키워드 빈도 분석 알고리즘이 수행하고, Claude는 요약 작성에만 사용한다. web_search를 사용하지 않아 토큰 비용을 최소화했다.

---

## 1. 데이터 파이프라인

### 1-1. 크론 트리거

- **시간**: 매일 오전 7:00 (KST) = UTC 22:00
- **방법**: Supabase pg_cron + pg_net (Edge Function 직접 호출)
- **엔드포인트**: Supabase Edge Function `generate-topics`
- **보안**: Supabase JWT 인증 (verify_jwt: true)

### 1-2. 뉴스 수집 (네이버 검색 API)

네이버 검색 API로 최신 뉴스 1000건을 수집한다.

- **검색어**: `"뉴스"`
- **파라미터**: `display=100`, `sort=date`
- **호출 횟수**: 10회 (`start=1,101,201,...,901`)
- **수집 데이터**: 제목, 링크, 설명(description), 발행일

### 1-3. 핫토픽 자동 추출 (키워드 분석 알고리즘)

수집된 1000건의 뉴스 제목에서 키워드 조합 빈도를 분석하여 핫토픽 후보 10개를 추출한다.

**알고리즘**:
1. 각 기사 제목에서 2글자 이상 키워드 추출 (불용어 제거)
2. 2-키워드 조합별 등장 횟수 카운트
3. 빈도순 정렬
4. 이미 사용된 키워드와 겹치면 스킵 (중복 방지)
5. 3건 이상 기사가 있는 조합만 핫토픽으로 인정
6. 상위 10개 반환

**원리**: 같은 사건은 여러 언론사가 동시에 보도하므로, 키워드 조합 빈도가 높을수록 핫토픽일 가능성이 높다.

### 1-4. AI 요약 생성 (Claude API)

핫토픽 후보 10개를 Claude에 전달하여 5개를 선정하고 요약한다.

- **Claude 역할**: 토픽 선정(카테고리 분산) + 한국어 요약 + 출처 매핑
- **web_search 미사용**: 네이버 API에서 이미 기사 정보를 확보했으므로 불필요
- **토큰 사용량**: ~2,000 토큰/호출
- **선정 규칙**: 카테고리당 최대 2개 (정치, 경제, 사회, IT·테크, 문화·스포츠)
- **요약 규칙**: 3~5문장 (200~400자), 객관적 뉴스 브리핑 어조
- **출처**: 토픽당 3~4개 URL (네이버 API에서 가져온 실제 기사 링크)
- **검증**: Zod 스키마, 최대 3회 재시도

### 1-5. DB 저장

요약 결과를 Supabase에 저장한다. 같은 날짜 데이터가 이미 있으면 삭제 후 재삽입.

---

## 2. 데이터베이스 설계 (Supabase)

### 테이블: `daily_topics`

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid (PK) | 자동 생성 |
| `date` | date | 게시 날짜 (unique 제약 조건 with topic_order) |
| `topic_order` | int2 | 토픽 순서 (1~5) |
| `title` | text | 토픽 제목 |
| `category` | text | 카테고리 (정치, 경제, 사회, IT·테크, 문화·스포츠) |
| `summary` | text | 요약 내용 |
| `keywords` | text[] | 키워드 배열 |
| `sources` | jsonb | 출처 기사 배열 `[{title, url}]` |
| `created_at` | timestamptz | 생성 시각 |

### 테이블: `pipeline_logs`

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

### RLS (Row Level Security)

- `daily_topics`: 읽기는 전체 공개 (anon), 쓰기는 service_role만 허용
- `pipeline_logs`: 읽기/쓰기 모두 service_role만 허용

---

## 3. Supabase Edge Function

### 디렉토리 구조

```
supabase/functions/generate-topics/
├── index.ts           # 엔트리포인트 (JWT 인증)
├── naver.ts           # 네이버 뉴스 API 호출 (1000건 수집)
├── topics.ts          # 키워드 빈도 분석 → 핫토픽 추출
├── claude.ts          # Claude API 호출 (요약 전용, web_search 없음)
├── prompts.ts         # 프롬프트 템플릿
├── schemas.ts         # Zod 검증 스키마
└── pipeline.ts        # 파이프라인 오케스트레이터
```

---

## 4. 프론트엔드 (블로그)

### 페이지 구성

| 경로 | 설명 | 렌더링 방식 |
|---|---|---|
| `/` | 오늘의 핫토픽 5개 표시 | ISR (1일) |
| `/archive` | 날짜별 아카이브 목록 | ISR (1일) |
| `/archive/[date]` | 특정 날짜 핫토픽 | ISR (1일) |
| `/og` | OG 이미지 동적 생성 | Route Handler |
| `/sitemap.xml` | 사이트맵 자동 생성 | - |

### 디자인 방향

- **뉴스레터 스타일**: 최대 너비 640px 중앙 정렬
- **서체**: Noto Serif KR (본문), Geist Sans (UI)
- **색상**: warm neutral (stone 계열), 카테고리별 포인트 컬러
- **번호 표기**: 01~05 큰 숫자로 시각적 앵커
- 카테고리별 컬러 태그 (정치=red, 경제=blue, 사회=amber, IT계열=violet, 문화·스포츠=emerald)
- 모바일 퍼스트 반응형 + 다크모드 지원
- 출처 링크는 새 탭으로 열기

### SEO 최적화

- 동적 메타태그 (날짜별 title, description)
- OG 이미지 자동 생성 (`/og?date=YYYY-MM-DD`, Noto Sans KR 폰트)
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
| `ANTHROPIC_API_KEY` | Claude API 인증 (요약 전용) |
| `NAVER_CLIENT_ID` | 네이버 검색 API Client ID |
| `NAVER_CLIENT_SECRET` | 네이버 검색 API Client Secret |

> `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Edge Function에서 자동 주입.

---

## 6. 프로젝트 구조

```
src/app/
├── layout.tsx                    # 루트 레이아웃 + 전역 메타데이터
├── page.tsx                      # 메인: 오늘의 핫토픽
├── loading.tsx                   # 로딩 스켈레톤
├── archive/
│   ├── page.tsx                  # 아카이브 목록
│   └── [date]/
│       ├── page.tsx              # 특정 날짜 상세
│       └── loading.tsx           # 로딩 스켈레톤
├── og/
│   └── route.tsx                 # OG 이미지 동적 생성
└── sitemap.ts                    # sitemap.xml 자동 생성

src/lib/
├── supabase.ts                   # Supabase 클라이언트 (anon key, 읽기 전용)
├── queries.ts                    # 데이터 조회 함수
└── types.ts                      # 공유 타입 정의

src/components/
├── TopicCard.tsx                 # 토픽 카드
├── CategoryBadge.tsx             # 카테고리 태그
├── SourceLinks.tsx               # 출처 링크 목록
├── DateNav.tsx                   # 날짜 네비게이션
├── NewsletterHeader.tsx          # 뉴스레터 스타일 헤더
├── TopicSkeleton.tsx             # 로딩 스켈레톤
└── JsonLd.tsx                    # JSON-LD 구조화 데이터

supabase/functions/generate-topics/
├── index.ts                      # 엔트리포인트
├── naver.ts                      # 네이버 뉴스 API
├── topics.ts                     # 키워드 빈도 분석
├── claude.ts                     # Claude API (요약)
├── prompts.ts                    # 프롬프트 템플릿
├── schemas.ts                    # Zod 검증
└── pipeline.ts                   # 오케스트레이터
```

---

## 7. 비용 추정 (월간)

| 항목 | 예상 비용 |
|---|---|
| Vercel Hobby | 무료 |
| Supabase Free tier | 무료 |
| 네이버 검색 API | 무료 (일 25,000건) |
| Claude API Sonnet (일 1회 × 30일, ~2K 토큰) | ~$1/월 |
| **합계** | **~$1/월** |

---

## 8. 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| 네이버 API 검색 결과 편향 | 검색어/파라미터 튜닝, 카테고리별 쿼리 추가 |
| 키워드 분석으로 핫토픽 누락 | 불용어 목록 관리, 최소 기사 수 임계값 조정 |
| Claude 요약 품질 불균일 | 프롬프트 튜닝, Zod 검증 + 재시도 |
| 같은 토픽 연일 반복 | 전일 토픽을 프롬프트에 포함하여 제외 |
| 출처 URL 깨짐 (404) | 네이버 API URL은 비교적 안정적 |
| pg_cron 실행 누락 | pipeline_logs 테이블에서 주기적 확인 |
| Claude API rate limit | web_search 제거로 해결 (~2K 토큰/호출) |
