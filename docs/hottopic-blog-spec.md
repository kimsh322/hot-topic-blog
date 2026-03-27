# 매일 핫토픽 자동 요약 블로그

## 프로젝트 개요

매일 아침 AI가 자동으로 한국의 핫토픽 5개를 선정하고, 관련 기사를 수집·요약하여 블로그에 게시하는 서비스.

**기술 스택**: Next.js (App Router) + Supabase + Claude API (web search) + Vercel

---

## 시스템 아키텍처

```
[Vercel Cron] → [Next.js API Route] → [Claude API + Web Search]
  매일 07:00 KST    /api/generate-topics     핫토픽 탐색 & 요약
                            ↓
                      [Supabase DB]
                            ↓
                   [Next.js 프론트엔드]
                     블로그 페이지 렌더링
```

---

## 1. 데이터 파이프라인

### 1-1. 크론 트리거

- **시간**: 매일 오전 7:00 (KST)
- **방법**: Vercel Cron (`vercel.json` 설정)
- **엔드포인트**: `POST /api/generate-topics`
- **보안**: `CRON_SECRET` 환경변수로 인증. 헤더에 `Authorization: Bearer {CRON_SECRET}` 포함 필수. 불일치 시 401 응답.

```jsonc
// vercel.json
{
  "crons": [
    {
      "path": "/api/generate-topics",
      "schedule": "0 22 * * *" // UTC 22:00 = KST 07:00
    }
  ]
}
```

### 1-2. 핫토픽 선정 (1차 호출)

Claude API에 `web_search` 도구를 활성화하고, 아래 기준으로 핫토픽 5개를 선정한다.

**선정 기준 (프롬프트에 명시)**:
- 소스: 네이버 뉴스 랭킹, 다음 뉴스, 구글 트렌드 한국을 교차 확인
- 시간 범위: 어제~오늘 아침 기준
- 카테고리 분산: 정치/경제/사회/IT·과학/문화·스포츠에서 골고루 (최소 3개 카테고리)
- 중복 방지: 같은 사건의 다른 각도 기사는 1개로 통합
- 제외: 연예인 사생활, 단순 광고성 이슈

**응답 형식**: JSON

```json
{
  "topics": [
    {
      "title": "토픽 제목",
      "category": "카테고리",
      "keywords": ["핵심", "키워드"]
    }
  ]
}
```

**검증 로직**:
- topics 배열이 5개 미만이면 재검색 (최대 3회 재시도)
- 3회 시도 후에도 부족하면 있는 만큼만 저장 + Slack/이메일 알림
- 중복 토픽(유사도 높은 제목) 자동 제거

### 1-3. 상세 요약 생성 (2차 호출)

선정된 5개 토픽에 대해 각각 관련 기사를 검색하고 요약한다.

**호출 전략**:
- 기본: 5개 토픽을 1회 호출로 묶어 처리 (비용 효율)
- 품질 저하 시: 토픽별 개별 호출로 전환 (테스트 후 결정)

**토픽별 요약 요구사항**:
- 요약 분량: 3~5문장 (200~400자)
- 어조: 객관적, 뉴스 브리핑 스타일
- 관련 기사 출처 URL 3개 이상 포함
- 핵심 수치나 인용이 있으면 포함

**응답 형식**: JSON

```json
{
  "date": "2026-03-27",
  "articles": [
    {
      "title": "토픽 제목",
      "category": "경제",
      "summary": "요약 내용...",
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

요약 결과를 Supabase에 저장한다. 저장 전 같은 날짜 데이터가 이미 있는지 확인하고, 있으면 업데이트(upsert) 처리.

---

## 2. 데이터베이스 설계 (Supabase)

### 테이블: `daily_topics`

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid (PK) | 자동 생성 |
| `date` | date | 게시 날짜 (unique 제약 조건 with topic_order) |
| `topic_order` | int2 | 토픽 순서 (1~5) |
| `title` | text | 토픽 제목 |
| `category` | text | 카테고리 (정치, 경제, 사회, IT·과학, 문화·스포츠) |
| `summary` | text | 요약 내용 |
| `keywords` | text[] | 키워드 배열 |
| `sources` | jsonb | 출처 기사 배열 `[{title, url}]` |
| `created_at` | timestamptz | 생성 시각 |

**인덱스**: `date` DESC (메인 목록 조회 최적화)

### 테이블: `pipeline_logs` (선택)

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

### RLS (Row Level Security)

- `daily_topics`: 읽기는 전체 공개 (anon), 쓰기는 service_role만 허용
- `pipeline_logs`: 읽기/쓰기 모두 service_role만 허용

---

## 3. API 엔드포인트

### `POST /api/generate-topics`

파이프라인 전체 실행. Cron에 의해 호출됨.

- **인증**: `Authorization: Bearer {CRON_SECRET}` 또는 Vercel Cron 자동 인증 헤더
- **처리 흐름**:
  1. 인증 검증
  2. 오늘 날짜 데이터 존재 여부 확인
  3. Claude API 1차 호출 (토픽 선정)
  4. 응답 검증 → 부족 시 재시도 (최대 3회)
  5. Claude API 2차 호출 (상세 요약)
  6. Supabase에 upsert
  7. pipeline_logs 기록
- **타임아웃**: Vercel Pro 기준 300초 (충분). Hobby는 60초라 부족할 수 있음 → 호출 분리 필요할 수 있음
- **응답**: `{ status: "success", topics_count: 5 }`

### `GET /api/topics`

프론트엔드 데이터 조회용. (또는 Supabase 클라이언트로 직접 조회)

- **쿼리 파라미터**: `?date=2026-03-27` 또는 `?page=1&limit=7`
- **응답**: daily_topics 배열

---

## 4. 프론트엔드 (블로그)

### 페이지 구성

| 경로 | 설명 | 렌더링 방식 |
|---|---|---|
| `/` | 오늘의 핫토픽 5개 표시 | ISR (1시간 재검증) |
| `/archive` | 날짜별 아카이브 목록 | ISR |
| `/archive/[date]` | 특정 날짜 핫토픽 | SSG (빌드 시 생성) |

### 메인 페이지 (`/`) UI 구성

```
┌─────────────────────────────────┐
│  📰 오늘의 핫토픽               │
│  2026년 3월 27일 금요일          │
├─────────────────────────────────┤
│                                 │
│  [경제] 한국은행 기준금리 동결    │
│  요약 내용 3~5줄...              │
│  출처: 조선일보 | 한경 | 연합뉴스 │
│                                 │
│  ─────────────────────────────  │
│                                 │
│  [IT·과학] OpenAI 신규 모델 발표  │
│  요약 내용 3~5줄...              │
│  출처: ZDNet | 블로터 | 전자신문  │
│                                 │
│  ... (총 5개)                   │
│                                 │
├─────────────────────────────────┤
│  ← 이전 날짜     아카이브 보기    │
└─────────────────────────────────┘
```

### 디자인 방향

- 미니멀, 읽기 중심 레이아웃
- 카테고리별 컬러 태그
- 모바일 퍼스트 반응형
- 다크모드 지원
- 출처 링크는 새 탭으로 열기

---

## 5. 환경변수

| 변수명 | 용도 | 위치 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API 인증 | Vercel env |
| `CRON_SECRET` | 크론 엔드포인트 인증 | Vercel env |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL | Vercel env |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 공개 키 (읽기용) | Vercel env |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서비스 키 (쓰기용) | Vercel env |
| `SLACK_WEBHOOK_URL` | 알림용 (선택) | Vercel env |

---

## 6. 프로젝트 구조

```
/app
  /page.tsx                   # 메인: 오늘의 핫토픽
  /archive/page.tsx           # 아카이브 목록
  /archive/[date]/page.tsx    # 날짜별 상세
  /api/generate-topics/route.ts   # 파이프라인 API
  /api/topics/route.ts            # 데이터 조회 API (선택)
/lib
  /supabase.ts                # Supabase 클라이언트 설정
  /claude.ts                  # Claude API 호출 로직
  /prompts.ts                 # 프롬프트 템플릿 관리
  /validators.ts              # 응답 검증 & 재시도 로직
/components
  /TopicCard.tsx              # 토픽 카드 컴포넌트
  /CategoryBadge.tsx          # 카테고리 태그
  /SourceLinks.tsx            # 출처 링크 목록
  /DateNav.tsx                # 날짜 네비게이션
vercel.json                   # 크론 설정
```

---

## 7. 작업 순서 (마일스톤)

### Phase 1 — 파이프라인 구축 (핵심)
1. Supabase 프로젝트 생성, 테이블 & RLS 설정
2. Next.js 프로젝트 초기화
3. Claude API 연동: 핫토픽 선정 프롬프트 작성 & 테스트
4. Claude API 연동: 상세 요약 프롬프트 작성 & 테스트
5. `/api/generate-topics` Route Handler 구현 (검증, 재시도, 저장)
6. 로컬에서 수동 호출로 E2E 테스트

### Phase 2 — 블로그 프론트엔드
7. 메인 페이지 (`/`) — 오늘의 핫토픽 표시
8. 아카이브 페이지 구현
9. 반응형 & 다크모드 스타일링
10. SEO 메타태그, OG 이미지

### Phase 3 — 배포 & 자동화
11. Vercel 배포
12. `vercel.json` 크론 설정
13. 며칠간 모니터링 — 프롬프트 품질 튜닝
14. (선택) Slack/이메일 알림 연동

### Phase 4 — 개선 (선택)
- RSS 피드 생성
- 뉴스레터 자동 발송
- 토픽별 관련 토픽 연결
- 주간/월간 하이라이트 자동 생성
- 검색 기능 (Supabase Full Text Search)

---

## 8. 비용 추정 (월간)

| 항목 | 예상 비용 |
|---|---|
| Vercel (Hobby) | 무료 (타임아웃 60초 제한 주의) |
| Vercel (Pro) | $20/월 (타임아웃 300초) |
| Claude API (Sonnet, 일 2회 호출 × 30일) | ~$3~8/월 |
| Supabase (Free tier) | 무료 (500MB DB, 충분) |
| **합계** | **무료 ~ $28/월** |

---

## 9. 리스크 & 대응

| 리스크 | 가능성 | 대응 |
|---|---|---|
| Claude 웹 검색 결과 부실 | 중 | 재시도 로직 + 프롬프트에 구체적 소스 앵커 명시 |
| Vercel Hobby 타임아웃 (60초) | 높음 | Pro 전환 또는 호출을 2단계로 분리 |
| 토픽 품질 불균일 | 중 | 프롬프트 반복 튜닝, 카테고리 분산 조건 강화 |
| API 비용 급증 | 낮음 | 재시도 최대 3회 제한, 일일 호출 횟수 상한 설정 |
| 출처 URL 깨짐 (404) | 중 | URL 유효성 검증 로직 추가 (선택) |
| 같은 토픽 연일 반복 | 중 | 전일 토픽 제목을 프롬프트에 포함하여 제외 요청 |
