# 매일 핫토픽 자동 요약 블로그 — 구현·설계 문서

---

## 1. 프로젝트 개요

매일 아침 AI가 한국 뉴스 + 글로벌 IT/테크 핫토픽 5개를 선정하고, 관련 기사를 수집·요약(한국어)하여 뉴스레터 스타일 블로그에 게시하는 서비스.

---

## 2. 기술 스택

| 레이어 | 기술 | 비고 |
|---|---|---|
| 프레임워크 | Next.js 16.2.1 (App Router) | 순수 프론트엔드, API Route 없음 |
| 런타임 | React 19.2.4 | |
| 스타일링 | Tailwind CSS 4.x | |
| DB | Supabase PostgreSQL | 기존 프로젝트 사용, Supabase MCP로 조작 |
| AI 파이프라인 | Supabase Edge Function (Deno) | 최대 400초 타임아웃 |
| AI | Claude API (Sonnet) | web_search 포함, fetch 직접 호출 (SDK 없음) |
| 스케줄러 | Supabase pg_cron + pg_net | Edge Function 직접 트리거 |
| 검증 | Zod | Claude 응답 파싱 (Edge Function 내) |
| E2E 테스트 | Playwright | Playwright MCP로 실행 |
| 배포 | Vercel Hobby (무료) | 프론트엔드만 배포 |
| 도메인 | *.vercel.app | 추후 커스텀 도메인 연결 가능 |
| 패키지 매니저 | pnpm 10.15.0 | |

---

## 3. 시스템 아키텍처

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

## 4. Supabase 데이터베이스

### 4-1. 테이블 생성 SQL

Supabase MCP를 통해 실행한다.

```sql
-- 핫토픽 메인 테이블
CREATE TABLE daily_topics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  topic_order SMALLINT NOT NULL CHECK (topic_order BETWEEN 1 AND 5),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  keywords TEXT[] DEFAULT '{}',
  sources JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (date, topic_order)
);

CREATE INDEX idx_daily_topics_date ON daily_topics (date DESC);

-- 파이프라인 실행 로그 (Supabase 대시보드에서 확인)
CREATE TABLE pipeline_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  topics_count SMALLINT DEFAULT 0,
  retry_count SMALLINT DEFAULT 0,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pipeline_logs_date ON pipeline_logs (date DESC);
```

### 4-2. RLS 정책

```sql
ALTER TABLE daily_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access"
  ON daily_topics FOR SELECT
  USING (true);

CREATE POLICY "Service role write access"
  ON daily_topics FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE pipeline_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only"
  ON pipeline_logs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

### 4-3. 유틸리티 함수

```sql
-- 전일 토픽 제목 조회 (중복 방지용)
CREATE OR REPLACE FUNCTION get_yesterday_titles()
RETURNS TEXT[] AS $$
  SELECT COALESCE(array_agg(title), '{}'::TEXT[])
  FROM daily_topics
  WHERE date = CURRENT_DATE - 1;
$$ LANGUAGE sql STABLE;
```

### 4-4. pg_cron 스케줄 등록

Supabase 대시보드 > SQL Editor에서 실행한다. pg_cron과 pg_net 확장이 활성화되어 있어야 한다.

```sql
-- 확장 활성화 (이미 활성화되어 있으면 생략)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 매일 KST 07:00 (UTC 22:00) 에 Edge Function 호출
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

> `<project-ref>`와 `<SUPABASE_SERVICE_ROLE_KEY>`는 실제 값으로 교체한다.

**스케줄 관리 명령**:
```sql
-- 등록된 크론 확인
SELECT * FROM cron.job;

-- 크론 비활성화
SELECT cron.unschedule('daily-hottopic-pipeline');

-- 수동 실행 (테스트용)
SELECT net.http_post(
  url := 'https://<project-ref>.supabase.co/functions/v1/generate-topics',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer <SUPABASE_SERVICE_ROLE_KEY>'
  ),
  body := '{}'::jsonb
);
```

---

## 5. Supabase Edge Function 설계

### 5-1. 디렉토리 구조

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

### 5-2. 엔트리포인트 (`index.ts`)

```typescript
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { runPipeline } from "./pipeline.ts";

serve(async (req: Request) => {
  // 인증: service_role key 확인
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey!,
  );

  const result = await runPipeline(supabase);

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
    status: result.status === "failed" ? 500 : 200,
  });
});
```

### 5-3. Claude API 호출 (`claude.ts`)

SDK 없이 fetch로 직접 호출한다.

```typescript
interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

interface ClaudeCallOptions {
  system?: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
}

async function callClaude(options: ClaudeCallOptions): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: options.maxTokens ?? 4096,
      system: options.system,
      messages: options.messages,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} ${error}`);
  }

  const data = await response.json();

  // text 블록만 추출하여 결합
  const text = data.content
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text)
    .join("\n");

  return text;
}
```

### 5-4. 프롬프트 설계 (`prompts.ts`)

**1차: 토픽 선정**

```typescript
function buildTopicSelectionPrompt(
  today: string,
  yesterdayTitles: string[],
): { system: string; user: string } {
  const excludeSection = yesterdayTitles.length > 0
    ? `\n## 제외 토픽 (어제 다룬 주제)\n${yesterdayTitles.map((t) => `- ${t}`).join("\n")}`
    : "";

  return {
    system: "당신은 한국 뉴스 및 글로벌 IT/테크 트렌드 큐레이터입니다. 반드시 JSON만 응답하세요.",
    user: `오늘은 ${today}입니다.

## 작업
어제부터 오늘 아침까지 가장 화제가 된 뉴스 토픽 5개를 선정하세요.

## 토픽 범위
- 한국 뉴스: 정치, 경제, 사회 등 (네이버 뉴스, 다음 뉴스, 구글 트렌드 한국 교차 확인)
- 글로벌 IT/테크: 해외 기술 뉴스, AI, 스타트업 등

## 선정 기준
- 한국 뉴스 3~4개 + 글로벌 IT/테크 1~2개 (유동적으로 배분)
- 같은 사건의 다른 기사는 하나로 통합
- 제외: 연예인 사생활, 단순 광고성 콘텐츠
${excludeSection}

## 응답 형식 (JSON만, 다른 텍스트 없이)
{
  "topics": [
    {
      "title": "토픽 제목 (15자 이내)",
      "category": "카테고리명",
      "keywords": ["키워드1", "키워드2", "키워드3"]
    }
  ]
}`,
  };
}
```

**2차: 상세 요약**

```typescript
function buildSummaryPrompt(
  today: string,
  topics: Topic[],
): { system: string; user: string } {
  return {
    system: "당신은 뉴스 브리핑 작성자입니다. 반드시 JSON만 응답하세요.",
    user: `오늘은 ${today}입니다.

## 작업
아래 토픽들에 대해 각각 관련 기사를 웹 검색하여 한국어로 요약하세요.

## 토픽 목록
${JSON.stringify(topics, null, 2)}

## 요약 규칙
- 토픽당 3~5문장 (200~400자)
- 객관적 뉴스 브리핑 어조
- 핵심 수치, 인용이 있으면 포함
- 관련 기사 출처 URL을 최소 2개 포함 (실제 접근 가능한 URL만)

## 응답 형식 (JSON만, 다른 텍스트 없이)
{
  "articles": [
    {
      "title": "토픽 제목",
      "category": "카테고리",
      "summary": "한국어 요약 내용",
      "keywords": ["키워드1", "키워드2"],
      "sources": [
        { "title": "기사 제목", "url": "https://..." }
      ]
    }
  ]
}`,
  };
}
```

### 5-5. Zod 검증 스키마 (`schemas.ts`)

```typescript
import { z } from "https://esm.sh/zod";

export const TopicSchema = z.object({
  title: z.string().min(2).max(50),
  category: z.string().min(1),
  keywords: z.array(z.string()).min(1).max(5),
});

export const TopicSelectionResponse = z.object({
  topics: z.array(TopicSchema).min(1).max(5),
});

export const SourceSchema = z.object({
  title: z.string(),
  url: z.string().url(),
});

export const ArticleSchema = z.object({
  title: z.string(),
  category: z.string(),
  summary: z.string().min(50).max(800),
  keywords: z.array(z.string()),
  sources: z.array(SourceSchema).min(1),
});

export const SummaryResponse = z.object({
  articles: z.array(ArticleSchema).min(1).max(5),
});

// Claude 응답에서 JSON 추출 후 파싱
export function parseClaudeJSON<T>(raw: string, schema: z.ZodType<T>): T {
  const cleaned = raw.replace(/```json\n?|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  return schema.parse(parsed);
}
```

### 5-6. 파이프라인 오케스트레이터 (`pipeline.ts`)

```typescript
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js";
import { callClaude } from "./claude.ts";
import { buildTopicSelectionPrompt, buildSummaryPrompt } from "./prompts.ts";
import {
  parseClaudeJSON,
  TopicSelectionResponse,
  SummaryResponse,
} from "./schemas.ts";

interface PipelineResult {
  status: "success" | "partial" | "failed";
  topicsCount: number;
  retryCount: number;
  durationMs: number;
  error?: string;
}

export async function runPipeline(
  supabase: SupabaseClient,
): Promise<PipelineResult> {
  const startTime = Date.now();
  const today = new Date().toISOString().split("T")[0];
  let retryCount = 0;

  try {
    // 1. 전일 토픽 조회
    const { data: yesterdayData } = await supabase.rpc("get_yesterday_titles");
    const yesterdayTitles: string[] = yesterdayData ?? [];

    // 2. 토픽 선정 (최대 3회 재시도)
    let topics = [];
    while (retryCount <= 3 && topics.length < 5) {
      const prompt = buildTopicSelectionPrompt(today, yesterdayTitles);
      const raw = await callClaude({
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
      });

      try {
        const result = parseClaudeJSON(raw, TopicSelectionResponse);
        topics = result.topics;
      } catch {
        retryCount++;
        continue;
      }

      if (topics.length < 5) retryCount++;
    }

    if (topics.length === 0) {
      await logPipeline(supabase, {
        date: today, status: "failed", topicsCount: 0,
        retryCount, durationMs: Date.now() - startTime,
        error: "토픽 선정 실패",
      });
      return {
        status: "failed", topicsCount: 0, retryCount,
        durationMs: Date.now() - startTime, error: "토픽 선정 실패",
      };
    }

    // 3. 상세 요약 생성
    const summaryPrompt = buildSummaryPrompt(today, topics);
    const summaryRaw = await callClaude({
      system: summaryPrompt.system,
      messages: [{ role: "user", content: summaryPrompt.user }],
    });
    const { articles } = parseClaudeJSON(summaryRaw, SummaryResponse);

    // 4. DB 저장 (기존 데이터 삭제 후 삽입)
    await supabase.from("daily_topics").delete().eq("date", today);
    const rows = articles.map((article, i) => ({
      date: today,
      topic_order: i + 1,
      title: article.title,
      category: article.category,
      summary: article.summary,
      keywords: article.keywords,
      sources: article.sources,
    }));
    await supabase.from("daily_topics").insert(rows);

    // 5. 로그 기록
    const status = articles.length >= 5 ? "success" : "partial";
    await logPipeline(supabase, {
      date: today, status, topicsCount: articles.length,
      retryCount, durationMs: Date.now() - startTime,
    });

    return {
      status, topicsCount: articles.length,
      retryCount, durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await logPipeline(supabase, {
      date: today, status: "failed", topicsCount: 0,
      retryCount, durationMs: Date.now() - startTime, error: errorMsg,
    });
    return {
      status: "failed", topicsCount: 0, retryCount,
      durationMs: Date.now() - startTime, error: errorMsg,
    };
  }
}

async function logPipeline(supabase: SupabaseClient, log: {
  date: string; status: string; topicsCount: number;
  retryCount: number; durationMs: number; error?: string;
}) {
  await supabase.from("pipeline_logs").insert({
    date: log.date,
    status: log.status,
    topics_count: log.topicsCount,
    retry_count: log.retryCount,
    duration_ms: log.durationMs,
    error_message: log.error ?? null,
  });
}
```

### 5-7. Edge Function 환경변수

Supabase 대시보드 > Edge Functions > Secrets에서 설정한다.

| 변수명 | 용도 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API 인증 |

> `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Edge Function 내에서 자동으로 사용 가능하다.

### 5-8. 배포

```bash
# Supabase CLI로 Edge Function 배포
supabase functions deploy generate-topics
```

---

## 6. Next.js 프론트엔드

### 6-1. 프로젝트 구조

```
app/
├── layout.tsx                    # 루트 레이아웃 + 전역 메타데이터
├── page.tsx                      # 메인: 오늘의 핫토픽
├── archive/
│   ├── page.tsx                  # 아카이브 목록
│   └── [date]/
│       └── page.tsx              # 특정 날짜 상세
├── og/
│   └── route.tsx                 # OG 이미지 동적 생성 (ImageResponse)
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
```

### 6-2. Supabase 클라이언트 (`lib/supabase.ts`)

```typescript
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
```

### 6-3. 데이터 조회 (`lib/queries.ts`)

```typescript
import { supabase } from "./supabase";

// 특정 날짜 토픽 조회
export async function getTopicsByDate(date: string) {
  const { data, error } = await supabase
    .from("daily_topics")
    .select("*")
    .eq("date", date)
    .order("topic_order", { ascending: true });

  if (error) throw error;
  return data;
}

// 가장 최근 날짜 토픽 조회 (메인 페이지용)
export async function getLatestTopics() {
  const { data } = await supabase
    .from("daily_topics")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .single();

  if (!data) return { topics: [], date: null };

  const topics = await getTopicsByDate(data.date);
  return { topics, date: data.date };
}

// 아카이브: 토픽이 존재하는 날짜 목록
export async function getArchiveDates(page = 1, perPage = 20) {
  const { data, error } = await supabase
    .from("daily_topics")
    .select("date")
    .order("date", { ascending: false });

  if (error) throw error;

  // 중복 날짜 제거 후 페이지네이션
  const uniqueDates = [...new Set(data.map((d) => d.date))];
  const start = (page - 1) * perPage;
  return {
    dates: uniqueDates.slice(start, start + perPage),
    total: uniqueDates.length,
  };
}
```

### 6-4. 페이지별 렌더링

모든 페이지는 ISR로 동작한다.

**메인 페이지 (`app/page.tsx`)**

```typescript
export const revalidate = 3600; // 1시간마다 재검증

export default async function Home() {
  const { topics, date } = await getLatestTopics();
  // 뉴스레터 스타일 렌더링
}
```

**아카이브 목록 (`app/archive/page.tsx`)**

```typescript
export const revalidate = 86400; // 24시간

export default async function Archive() {
  const { dates } = await getArchiveDates();
  // 날짜 목록 렌더링
}
```

**날짜별 상세 (`app/archive/[date]/page.tsx`)**

```typescript
export const revalidate = 86400; // 24시간

export default async function DateDetail({ params }) {
  const { date } = await params;
  const topics = await getTopicsByDate(date);
  // 해당 날짜 토픽 렌더링
}
```

---

## 7. SEO 최적화

### 7-1. 메타태그 + 동적 메타데이터

```typescript
// app/layout.tsx
export const metadata: Metadata = {
  title: {
    default: "오늘의 핫토픽 — AI 뉴스 브리핑",
    template: "%s | 오늘의 핫토픽",
  },
  description: "매일 아침 AI가 선정한 한국 뉴스 + 글로벌 IT/테크 핫토픽 5개를 요약합니다.",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "오늘의 핫토픽",
  },
  robots: { index: true, follow: true },
};
```

```typescript
// app/archive/[date]/page.tsx
export async function generateMetadata({ params }): Promise<Metadata> {
  const { date } = await params;
  const topics = await getTopicsByDate(date);
  const topicTitles = topics.map((t) => t.title).join(", ");

  return {
    title: `${formatDateKR(date)} 핫토픽`,
    description: `${formatDateKR(date)} 주요 뉴스: ${topicTitles}`,
    openGraph: {
      title: `${formatDateKR(date)} 핫토픽`,
      description: topicTitles,
      images: [`/og?date=${date}`],
    },
  };
}
```

### 7-2. OG 이미지 자동 생성 (`app/og/route.tsx`)

Next.js의 `ImageResponse`를 사용하여 날짜별 OG 이미지를 동적으로 생성한다.

```typescript
import { ImageResponse } from "next/og";
import { getTopicsByDate, getLatestTopics } from "@/lib/queries";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  const topics = date
    ? await getTopicsByDate(date)
    : (await getLatestTopics()).topics;

  const displayDate = date ?? new Date().toISOString().split("T")[0];

  return new ImageResponse(
    (
      <div style={{
        width: "1200px", height: "630px",
        display: "flex", flexDirection: "column",
        padding: "60px", backgroundColor: "#fafaf9",
        fontFamily: "sans-serif",
      }}>
        <div style={{ fontSize: "28px", color: "#78716c" }}>
          {formatDateKR(displayDate)}
        </div>
        <div style={{ fontSize: "48px", fontWeight: 700, marginTop: "12px" }}>
          오늘의 핫토픽
        </div>
        <div style={{
          display: "flex", flexDirection: "column",
          gap: "16px", marginTop: "32px",
        }}>
          {topics.slice(0, 5).map((t, i) => (
            <div key={i} style={{ fontSize: "28px", color: "#44403c" }}>
              {i + 1}. {t.title}
            </div>
          ))}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
```

### 7-3. JSON-LD 구조화 데이터

각 날짜 페이지에 `NewsArticle` 타입의 JSON-LD를 삽입한다.

```typescript
// components/JsonLd.tsx
export function TopicJsonLd({ topic, date }: { topic: DailyTopic; date: string }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: topic.title,
    description: topic.summary,
    datePublished: date,
    author: {
      "@type": "Organization",
      name: "오늘의 핫토픽 AI",
    },
    keywords: topic.keywords.join(", "),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
```

메인/상세 페이지에서 토픽마다 `<TopicJsonLd />` 렌더링.

### 7-4. sitemap.xml 자동 생성 (`app/sitemap.ts`)

```typescript
import { MetadataRoute } from "next";
import { supabase } from "@/lib/supabase";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 토픽이 존재하는 모든 날짜 조회
  const { data } = await supabase
    .from("daily_topics")
    .select("date")
    .order("date", { ascending: false });

  const uniqueDates = [...new Set(data?.map((d) => d.date) ?? [])];

  const datePages = uniqueDates.map((date) => ({
    url: `https://<your-domain>/archive/${date}`,
    lastModified: date,
    changeFrequency: "never" as const,
  }));

  return [
    { url: "https://<your-domain>", lastModified: new Date(), changeFrequency: "daily" },
    { url: "https://<your-domain>/archive", lastModified: new Date(), changeFrequency: "daily" },
    ...datePages,
  ];
}
```

---

## 8. 뉴스레터 스타일 디자인 가이드

### 8-1. 레이아웃 컨셉

```
┌─────────────────────────────────────────────┐
│                                             │
│    오늘의 핫토픽                              │
│    2026년 3월 28일 토요일                     │
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

### 8-2. 스타일 원칙

- **최대 너비**: 640px 중앙 정렬 (이메일 뉴스레터와 동일한 가독성)
- **서체**: 시스템 세리프 또는 Noto Serif KR (본문), 산세리프 (카테고리 배지)
- **색상**: 따뜻한 뉴트럴 계열 (stone/warm gray), 카테고리별 포인트 컬러
- **구분선**: 얇은 수평선으로 토픽 사이 구분 (border-t)
- **번호 표기**: 01~05 큰 숫자로 시각적 앵커
- **여백**: 넉넉한 상하 패딩으로 콘텐츠 간 호흡
- **반응형**: 모바일에서도 동일한 단일 컬럼 레이아웃
- **다크모드**: Tailwind dark: prefix로 대응

### 8-3. 카테고리 색상 매핑

```typescript
const categoryStyle: Record<string, string> = {
  "정치":      "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  "경제":      "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  "사회":      "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  "IT·과학":   "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  "IT·테크":   "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  "문화·스포츠": "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};
```

---

## 9. E2E 테스트 (Playwright MCP)

### 9-1. 테스트 전략

```
e2e/
├── blog-home.spec.ts          # 메인 페이지
├── blog-archive.spec.ts       # 아카이브 페이지
├── responsive.spec.ts         # 반응형 + 다크모드
└── playwright.config.ts       # 설정
```

파이프라인(Edge Function) 테스트는 Supabase 대시보드 + pipeline_logs 테이블에서 확인한다. Playwright는 프론트엔드 UI 테스트에만 집중한다.

### 9-2. Playwright 설정

```typescript
// e2e/playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  baseURL: "http://localhost:3000",
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { browserName: "chromium", viewport: { width: 1280, height: 720 } },
    },
    {
      name: "mobile",
      use: { browserName: "webkit", viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: {
    command: "pnpm dev",
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
```

### 9-3. 테스트 시나리오

**메인 페이지** (`e2e/blog-home.spec.ts`)

```typescript
import { test, expect } from "@playwright/test";

test.describe("메인 페이지", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("페이지 타이틀에 핫토픽 포함", async ({ page }) => {
    await expect(page).toHaveTitle(/핫토픽/);
  });

  test("토픽 카드 1~5개 렌더링", async ({ page }) => {
    const cards = page.locator("[data-testid='topic-card']");
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(5);
  });

  test("각 카드에 카테고리 배지", async ({ page }) => {
    const badge = page.locator("[data-testid='category-badge']").first();
    await expect(badge).toBeVisible();
  });

  test("요약 텍스트 50자 이상", async ({ page }) => {
    const summary = page.locator("[data-testid='topic-summary']").first();
    const text = await summary.textContent();
    expect(text!.length).toBeGreaterThan(50);
  });

  test("출처 링크 새 탭으로 열림", async ({ page }) => {
    const link = page.locator("[data-testid='source-link']").first();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("날짜 표시 (YYYY년 M월 D일 형식)", async ({ page }) => {
    const dateEl = page.locator("[data-testid='display-date']");
    await expect(dateEl).toContainText(/\d{4}년 \d{1,2}월 \d{1,2}일/);
  });

  test("JSON-LD 구조화 데이터 존재", async ({ page }) => {
    const jsonLd = page.locator('script[type="application/ld+json"]');
    const count = await jsonLd.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
```

**아카이브 페이지** (`e2e/blog-archive.spec.ts`)

```typescript
import { test, expect } from "@playwright/test";

test.describe("아카이브", () => {
  test("날짜 목록 렌더링", async ({ page }) => {
    await page.goto("/archive");
    const items = page.locator("[data-testid='archive-date-item']");
    await expect(items.first()).toBeVisible();
  });

  test("날짜 클릭 → 해당 날짜 페이지로 이동", async ({ page }) => {
    await page.goto("/archive");
    await page.locator("[data-testid='archive-date-item']").first().click();
    await expect(page).toHaveURL(/\/archive\/\d{4}-\d{2}-\d{2}/);
    await expect(page.locator("[data-testid='topic-card']").first()).toBeVisible();
  });
});
```

**반응형 + 다크모드** (`e2e/responsive.spec.ts`)

```typescript
import { test, expect } from "@playwright/test";

test("모바일: 카드가 전체 너비 사용", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const card = page.locator("[data-testid='topic-card']").first();
  const box = await card.boundingBox();
  expect(box!.width).toBeGreaterThan(300);
});

test("다크모드: 배경색 변경됨", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const bg = await page.evaluate(() =>
    window.getComputedStyle(document.body).backgroundColor,
  );
  expect(bg).not.toBe("rgb(255, 255, 255)");
});
```

### 9-4. Playwright MCP 활용

Playwright MCP를 통해 Claude에게 직접 브라우저 테스트를 요청할 수 있다.

```
활용 예시:
- "메인 페이지 열어서 토픽 카드가 제대로 보이는지 확인해줘"
- "모바일 뷰포트에서 레이아웃 깨지는 거 없는지 스크린샷 찍어줘"
- "아카이브 페이지에서 날짜 클릭하면 상세 페이지로 이동하는지 테스트해줘"
- "다크모드에서 텍스트 가독성 문제 없는지 확인해줘"
```

### 9-5. CI 연동 (GitHub Actions)

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install
      - run: pnpm exec playwright install --with-deps
      - run: pnpm exec playwright test
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

---

## 10. 환경변수

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

## 11. 작업 순서

### Phase 1 — 파이프라인 구축
1. Supabase MCP로 테이블, RLS, 함수 생성
2. Edge Function 작성 (generate-topics)
3. Claude 프롬프트 작성 및 테스트 (수동 호출)
4. Zod 스키마 검증, 재시도 로직 확인
5. pg_cron + pg_net 스케줄 등록
6. 며칠간 자동 실행 모니터링 (pipeline_logs 확인)

### Phase 2 — 프론트엔드
7. Next.js 프로젝트에 Supabase 연동
8. 메인 페이지 (뉴스레터 스타일)
9. 아카이브 페이지
10. 반응형 + 다크모드
11. SEO: 메타태그, OG 이미지, JSON-LD, sitemap.xml

### Phase 3 — 테스트 & 배포
12. Playwright E2E 테스트 작성
13. Vercel 배포 + 환경변수 설정
14. GitHub Actions CI 파이프라인 설정
15. 프롬프트 품질 튜닝

### Phase 4 — 개선 (선택)
- RSS 피드
- 뉴스레터 이메일 발송 (Resend)
- 검색 기능 (Supabase Full Text Search)
- 주간 하이라이트 자동 생성

---

## 12. 비용 추정 (월간)

| 항목 | 비용 |
|---|---|
| Vercel Hobby | 무료 |
| Supabase Free tier (500MB DB, Edge Functions 포함) | 무료 |
| Claude API Sonnet (일 2회 호출 × 30일) | ~$3~8 |
| **합계** | **~$3~8/월** |

---

## 13. 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| Claude 웹 검색 결과 부실 | 재시도 3회 + 프롬프트에 구체적 소스 앵커 명시 |
| Edge Function 400초 초과 | 토픽 선정/요약을 별도 Function으로 분리 |
| 토픽 품질 불균일 | 프롬프트 반복 튜닝, 한국/글로벌 비율 조건 강화 |
| 같은 토픽 연일 반복 | 전일 토픽을 프롬프트에 포함하여 제외 |
| 출처 URL 깨짐 (404) | 향후 URL HEAD 요청 검증 추가 (P2) |
| pg_cron 실행 누락 | pipeline_logs 테이블에서 주기적 확인 |
