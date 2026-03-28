# 매일 핫토픽 자동 요약 블로그 — 구현·설계 문서

---

## 1. 프로젝트 개요

매일 아침 네이버 뉴스 API로 최신 뉴스 1000건을 수집하고, 키워드 빈도 분석으로 핫토픽 10개 후보를 자동 추출한 뒤, Claude가 5개를 선정·요약(한국어)하여 뉴스레터 스타일 블로그에 게시하는 서비스.

---

## 2. 기술 스택

| 레이어 | 기술 | 비고 |
|---|---|---|
| 프레임워크 | Next.js 16.2.1 (App Router) | 순수 프론트엔드, API Route 없음 |
| 런타임 | React 19.2.4 | |
| 스타일링 | Tailwind CSS 4.x | |
| 폰트 | Noto Serif KR (본문), Geist Sans (UI), Geist Mono | next/font/google |
| DB | Supabase PostgreSQL | 기존 프로젝트 사용, Supabase MCP로 조작 |
| 뉴스 수집 | Naver News Search API | 1000건 수집 (10회 API 호출) |
| 핫토픽 추출 | 키워드 빈도 분석 (topics.ts) | 순수 코드, AI 없음 |
| AI 요약 | Claude API (Sonnet) — 요약 전용 | 1회 호출, ~2000 토큰 |
| AI 파이프라인 | Supabase Edge Function (Deno) | 최대 400초 타임아웃 |
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
  │  1. Naver News API → 최신 뉴스 1000건 수집
  │  2. 키워드 빈도 분석 → 핫토픽 10개 후보 추출
  │  3. Claude API → 5개 선정 + 요약 (1회 호출)
  │  4. Zod 검증 & 재시도 (최대 3회)
  │  5. DB 저장 (delete + insert)
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

### 4-3. pg_cron 스케줄 등록

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
        ├── index.ts           # 엔트리포인트 (인증 + 요청 처리)
        ├── naver.ts           # Naver News API 호출 (1000건 수집)
        ├── topics.ts          # 키워드 빈도 분석 (핫토픽 추출)
        ├── claude.ts          # Claude API 호출 (요약 전용, fetch)
        ├── prompts.ts         # 프롬프트 템플릿 (영어)
        ├── schemas.ts         # Zod 검증 스키마
        └── pipeline.ts        # 파이프라인 오케스트레이터 + 재시도 로직
```

### 5-2. 엔트리포인트 (`index.ts`)

```typescript
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";
import { runPipeline } from "./pipeline.ts";

serve(async (req: Request) => {
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

### 5-3. Naver News API (`naver.ts`)

네이버 뉴스 검색 API로 최신 뉴스 1000건을 수집한다. 10회 호출(100건 x 10페이지).

```typescript
interface NaverNewsItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

export async function fetchNaverNews(): Promise<NaverNewsItem[]> {
  const clientId = Deno.env.get("NAVER_CLIENT_ID");
  const clientSecret = Deno.env.get("NAVER_CLIENT_SECRET");
  const allItems: NaverNewsItem[] = [];

  // 1000건 수집 (10회 호출)
  for (let page = 0; page < 10; page++) {
    const start = page * 100 + 1;
    const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent("뉴스")}&display=100&start=${start}&sort=date`;

    const response = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": clientId!,
        "X-Naver-Client-Secret": clientSecret!,
      },
    });

    if (!response.ok) {
      throw new Error(`Naver API error: ${response.status}`);
    }

    const data = await response.json();

    for (const item of data.items) {
      allItems.push({
        title: cleanHtml(item.title),
        link: item.link,
        description: cleanHtml(item.description),
        pubDate: item.pubDate,
      });
    }
  }

  return allItems;
}

function cleanHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
```

### 5-4. 키워드 빈도 분석 (`topics.ts`)

순수 코드로 뉴스 제목에서 2-키워드 조합의 빈도를 계산하여 핫토픽을 추출한다. AI 호출 없음.

```typescript
interface NewsItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

export interface HotTopic {
  keywords: string[];
  count: number;
  articles: NewsItem[];
}

const STOPWORDS = new Set([
  "뉴스", "오늘", "기자", "제공", "관련", "대한", "이번", "통해", "위해",
  "것으로", "으로", "에서", "대해", "한다", "있다", "했다", "된다", "하는", "있는",
  "라며", "이라고", "인사", "포토", "사진", "영상", "속보", "종합", "단독", "업데이트",
  "quot", "amp",
  "연합뉴스", "헤럴드경제", "한겨레", "한국경제", "매일경제", "조선일보", "중앙일보",
  "서울", "부산", "대전", "대구", "광주", "제주", "경기", "전국", "지역",
  "대표", "위원", "의원", "장관", "시장", "전면", "이상", "이후", "이전", "올해",
  "지난해", "현재", "내년", "최근", "이날",
]);

export function extractHotTopics(
  newsItems: NewsItem[],
  topicCount = 10,
): HotTopic[] {
  // 각 기사에서 키워드 추출
  const articleKeywords: string[][] = newsItems.map((item) => {
    const words = item.title.match(/[가-힣A-Za-z0-9]{2,}/g) ?? [];
    return [...new Set(words.filter((w) => !STOPWORDS.has(w)))];
  });

  // 2-키워드 조합 빈도 계산
  const pairCounts = new Map<string, number>();
  const pairArticles = new Map<string, number[]>();

  for (let i = 0; i < articleKeywords.length; i++) {
    const words = articleKeywords[i];
    for (let a = 0; a < words.length; a++) {
      for (let b = a + 1; b < words.length; b++) {
        const pair = [words[a], words[b]].sort().join("|");
        pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
        if (!pairArticles.has(pair)) pairArticles.set(pair, []);
        pairArticles.get(pair)!.push(i);
      }
    }
  }

  // 빈도순 정렬
  const sorted = [...pairCounts.entries()].sort((a, b) => b[1] - a[1]);

  // 핫토픽 추출 (키워드 겹침 방지)
  const usedIndices = new Set<number>();
  const usedKeywords = new Set<string>();
  const topics: HotTopic[] = [];

  for (const [pair, count] of sorted) {
    if (topics.length >= topicCount) break;

    const [kw1, kw2] = pair.split("|");
    if (usedKeywords.has(kw1) || usedKeywords.has(kw2)) continue;

    const indices = pairArticles
      .get(pair)!
      .filter((i) => !usedIndices.has(i));

    if (indices.length >= 3) {
      const articles = indices.slice(0, 5).map((i) => newsItems[i]);
      for (const i of indices) usedIndices.add(i);
      usedKeywords.add(kw1);
      usedKeywords.add(kw2);
      topics.push({ keywords: [kw1, kw2], count, articles });
    }
  }

  return topics;
}
```

**알고리즘 요약**:
1. 각 기사 제목에서 한글/영문 2글자 이상 단어를 추출하고 불용어를 제거
2. 기사 내 2-키워드 조합(pair)의 출현 빈도를 계산
3. 빈도순으로 정렬하되, 이미 사용된 키워드는 건너뜀 (중복 방지)
4. 최소 3개 기사에 등장하는 조합만 채택, 관련 기사 최대 5개 첨부

### 5-5. Claude API 호출 (`claude.ts`)

SDK 없이 fetch로 직접 호출한다. **요약 전용** — web_search 도구 없음.

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

export async function callClaude(options: ClaudeCallOptions): Promise<string> {
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
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${response.status} ${error}`);
  }

  const data = await response.json();

  // deno-lint-ignore no-explicit-any
  const text = data.content
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text)
    .join("\n");

  return text;
}
```

### 5-6. 프롬프트 설계 (`prompts.ts`)

**단일 프롬프트**: 10개 후보에서 5개 선정 + 요약을 한 번에 처리. 프롬프트는 영어, 응답은 한국어.

```typescript
import type { HotTopic } from "./topics.ts";

export function buildSummaryPrompt(
  today: string,
  hotTopics: HotTopic[],
): { system: string; user: string } {
  const topicList = hotTopics
    .map((t, i) => {
      const articles = t.articles
        .map((a) => `  - ${a.title}\n    ${a.description}\n    ${a.link}`)
        .join("\n");
      return `Candidate ${i + 1}: [${t.keywords.join(" + ")}] (${t.count} articles)\n${articles}`;
    })
    .join("\n\n");

  return {
    system: "You are a news briefing writer. Respond ONLY with valid JSON.",
    user: `Today: ${today}

## 10 Hot Topic Candidates (sorted by frequency from 1000 news articles)
${topicList}

## Selection Rules
- Pick exactly 5 from the 10 candidates above
- Assign category: 정치, 경제, 사회, IT·테크, or 문화·스포츠
- Max 2 topics per category (ensure diversity)
- Prioritize higher frequency candidates

## For each selected topic, write:
- title: Korean title (max 15 chars, descriptive)
- category: one of the categories above
- summary: Korean summary, 3-5 sentences (200-400 chars), objective tone, based on the article descriptions
- keywords: 2-3 Korean keywords
- sources: use the URLs from above (3-4 per topic)

## JSON format
{"articles":[{"title":"제목","category":"카테고리","summary":"한국어 요약","keywords":["k1","k2"],"sources":[{"title":"기사제목","url":"https://..."}]}]}`,
  };
}
```

**이전 버전과의 차이점**:
- 2단계(토픽 선정 → 요약)에서 **1단계로 통합** (Claude 1회 호출)
- web_search 제거 — 뉴스 수집은 Naver API가 담당
- 프롬프트가 영어 (토큰 절약), 응답만 한국어
- 전일 토픽 제외 로직 제거 (키워드 빈도 분석이 자연스럽게 당일 뉴스에 집중)

### 5-7. Zod 검증 스키마 (`schemas.ts`)

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

### 5-8. 파이프라인 오케스트레이터 (`pipeline.ts`)

재시도 로직을 포함한 전체 파이프라인. 별도 `retry.ts` 없이 `pipeline.ts`에서 직접 처리.

```typescript
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js";
import { callClaude } from "./claude.ts";
import { fetchNaverNews } from "./naver.ts";
import { extractHotTopics } from "./topics.ts";
import { buildSummaryPrompt } from "./prompts.ts";
import { parseClaudeJSON, SummaryResponse } from "./schemas.ts";

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
  const today = new Date(Date.now() + 9 * 3600 * 1000)
    .toISOString()
    .split("T")[0];
  let retryCount = 0;

  try {
    // 1. 네이버 뉴스 1000건 수집
    const newsItems = await fetchNaverNews();

    // 2. 키워드 빈도 분석으로 핫토픽 10개 후보 추출
    const hotTopics = extractHotTopics(newsItems, 10);

    if (hotTopics.length === 0) {
      await logPipeline(supabase, {
        date: today, status: "failed", topicsCount: 0,
        retryCount: 0, durationMs: Date.now() - startTime,
        error: "No hot topics found from news",
      });
      return {
        status: "failed", topicsCount: 0, retryCount: 0,
        durationMs: Date.now() - startTime,
        error: "No hot topics found from news",
      };
    }

    // 3. Claude로 5개 선정 + 요약 생성 (최대 3회 재시도)
    let articles;
    while (retryCount <= 3) {
      const prompt = buildSummaryPrompt(today, hotTopics);
      const raw = await callClaude({
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
      });

      try {
        const result = parseClaudeJSON(raw, SummaryResponse);
        articles = result.articles;
        break;
      } catch {
        retryCount++;
      }
    }

    if (!articles || articles.length === 0) {
      await logPipeline(supabase, {
        date: today, status: "failed", topicsCount: 0,
        retryCount, durationMs: Date.now() - startTime,
        error: "Summary generation failed",
      });
      return {
        status: "failed", topicsCount: 0, retryCount,
        durationMs: Date.now() - startTime,
        error: "Summary generation failed",
      };
    }

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

async function logPipeline(
  supabase: SupabaseClient,
  log: {
    date: string; status: string; topicsCount: number;
    retryCount: number; durationMs: number; error?: string;
  },
) {
  await supabase.from("pipeline_logs").insert({
    date: log.date, status: log.status,
    topics_count: log.topicsCount, retry_count: log.retryCount,
    duration_ms: log.durationMs, error_message: log.error ?? null,
  });
}
```

**파이프라인 흐름 요약**:
```
Naver API 1000건 → 키워드 빈도 분석 → 10개 후보 → Claude가 5개 선정(카테고리별 최대 2개) + 요약 → DB 저장
```

### 5-9. Edge Function 환경변수

Supabase 대시보드 > Edge Functions > Secrets에서 설정한다.

| 변수명 | 용도 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API 인증 |
| `NAVER_CLIENT_ID` | Naver 뉴스 검색 API 클라이언트 ID |
| `NAVER_CLIENT_SECRET` | Naver 뉴스 검색 API 클라이언트 시크릿 |

> `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Edge Function 내에서 자동으로 사용 가능하다.

### 5-10. 배포

```bash
# Supabase CLI로 Edge Function 배포
supabase functions deploy generate-topics
```

---

## 6. Next.js 프론트엔드

### 6-1. 프로젝트 구조

```
src/
├── app/
│   ├── layout.tsx                    # 루트 레이아웃 + 전역 메타데이터 + 폰트
│   ├── page.tsx                      # 메인: 오늘의 핫토픽
│   ├── loading.tsx                   # 메인 로딩 스켈레톤
│   ├── globals.css                   # Tailwind + CSS 변수 (라이트/다크)
│   ├── archive/
│   │   ├── page.tsx                  # 아카이브 목록
│   │   └── [date]/
│   │       ├── page.tsx              # 특정 날짜 상세
│   │       └── loading.tsx           # 상세 로딩 스켈레톤
│   ├── og/
│   │   └── route.tsx                 # OG 이미지 동적 생성 (ImageResponse)
│   └── sitemap.ts                    # sitemap.xml 자동 생성
├── lib/
│   ├── supabase.ts                   # Supabase 클라이언트 (anon key, 읽기 전용)
│   ├── queries.ts                    # 데이터 조회 함수 + formatDateKR
│   └── types.ts                      # 공유 타입 정의 + 카테고리 스타일
└── components/
    ├── TopicCard.tsx                 # 토픽 카드
    ├── CategoryBadge.tsx             # 카테고리 태그
    ├── SourceLinks.tsx               # 출처 링크 목록
    ├── DateNav.tsx                   # 날짜 네비게이션
    ├── NewsletterHeader.tsx          # 뉴스레터 스타일 헤더
    ├── TopicSkeleton.tsx             # 로딩 스켈레톤
    └── JsonLd.tsx                    # JSON-LD 구조화 데이터
```

### 6-2. Supabase 클라이언트 (`src/lib/supabase.ts`)

```typescript
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder";

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.warn("[supabase] NEXT_PUBLIC_SUPABASE_URL is not set");
}
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.warn("[supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

### 6-3. 데이터 조회 (`src/lib/queries.ts`)

```typescript
import { supabase } from "./supabase";
import type { DailyTopic } from "./types";

export async function getTopicsByDate(date: string): Promise<DailyTopic[]> {
  try {
    const { data, error } = await supabase
      .from("daily_topics")
      .select("*")
      .eq("date", date)
      .order("topic_order", { ascending: true });

    if (error) throw error;
    return data ?? [];
  } catch (error) {
    console.error("[getTopicsByDate] Failed:", error);
    return [];
  }
}

export async function getLatestTopics(): Promise<{
  topics: DailyTopic[];
  date: string | null;
}> {
  try {
    const { data } = await supabase
      .from("daily_topics")
      .select("date")
      .order("date", { ascending: false })
      .limit(1)
      .single();

    if (!data) return { topics: [], date: null };

    const topics = await getTopicsByDate(data.date);
    return { topics, date: data.date };
  } catch (error) {
    console.error("[getLatestTopics] Failed:", error);
    return { topics: [], date: null };
  }
}

export async function getArchiveDates(
  page = 1,
  perPage = 20,
): Promise<{ dates: string[]; total: number }> {
  try {
    const { data, error } = await supabase
      .from("daily_topics")
      .select("date")
      .order("date", { ascending: false });

    if (error) throw error;

    const uniqueDates = [...new Set((data ?? []).map((d) => d.date))];
    const start = (page - 1) * perPage;

    return {
      dates: uniqueDates.slice(start, start + perPage),
      total: uniqueDates.length,
    };
  } catch (error) {
    console.error("[getArchiveDates] Failed:", error);
    return { dates: [], total: 0 };
  }
}

export function formatDateKR(dateString: string): string {
  const date = new Date(dateString + "T00:00:00+09:00");
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Seoul",
  }).format(date);
}
```

### 6-4. 타입 정의 (`src/lib/types.ts`)

```typescript
export interface Source {
  title: string;
  url: string;
}

export interface DailyTopic {
  id: string;
  date: string;
  topic_order: number;
  title: string;
  category: string;
  summary: string;
  keywords: string[];
  sources: Source[];
  created_at: string;
}

export type Category =
  | "정치"
  | "경제"
  | "사회"
  | "IT·과학"
  | "IT·테크"
  | "문화·스포츠";

export const categoryStyles: Record<string, string> = {
  정치: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  경제: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  사회: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  "IT·과학":
    "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  "IT·테크":
    "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  "문화·스포츠":
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};
```

### 6-5. 페이지별 렌더링

모든 페이지는 ISR 1일(86400초)로 동작한다.

**메인 페이지 (`src/app/page.tsx`)**

```typescript
export const revalidate = 86400; // 1일마다 재검증

export default async function Home() {
  const { topics, date } = await getLatestTopics();
  // 뉴스레터 스타일 렌더링
}
```

**아카이브 목록 (`src/app/archive/page.tsx`)**

```typescript
export const revalidate = 86400; // 1일

export default async function ArchivePage() {
  const { dates } = await getArchiveDates();
  // 날짜 목록 렌더링
}
```

**날짜별 상세 (`src/app/archive/[date]/page.tsx`)**

```typescript
export const revalidate = 86400; // 1일

export default async function DateDetailPage(props: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await props.params;
  const topics = await getTopicsByDate(date);
  // 해당 날짜 토픽 렌더링
}
```

---

## 7. SEO 최적화

### 7-1. 메타태그 + 동적 메타데이터

```typescript
// src/app/layout.tsx
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
// src/app/archive/[date]/page.tsx
export async function generateMetadata(props: {
  params: Promise<{ date: string }>;
}): Promise<Metadata> {
  const { date } = await props.params;
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

### 7-2. OG 이미지 자동 생성 (`src/app/og/route.tsx`)

Next.js의 `ImageResponse`를 사용하여 날짜별 OG 이미지를 동적으로 생성한다. CDN에서 Noto Sans KR 폰트를 로드하여 한글 렌더링.

```typescript
import { ImageResponse } from "next/og";
import { getTopicsByDate, getLatestTopics, formatDateKR } from "@/lib/queries";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  const topics = date
    ? await getTopicsByDate(date)
    : (await getLatestTopics()).topics;

  const displayDate = date ?? new Date().toISOString().split("T")[0];

  let fontData: ArrayBuffer | undefined;
  try {
    const res = await fetch(
      "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-kr@latest/korean-400-normal.ttf",
    );
    if (res.ok) fontData = await res.arrayBuffer();
  } catch {
    // 폰트 로드 실패 시 시스템 폰트로 폴백
  }

  return new ImageResponse(
    (
      <div style={{
        width: "1200px", height: "630px",
        display: "flex", flexDirection: "column",
        padding: "60px", backgroundColor: "#fafaf9",
        fontFamily: "Noto Sans KR",
      }}>
        <div style={{ fontSize: "28px", color: "#78716c" }}>
          {formatDateKR(displayDate)}
        </div>
        <div style={{ fontSize: "48px", fontWeight: 700, marginTop: "12px", color: "#1c1917" }}>
          오늘의 핫토픽
        </div>
        <div style={{
          display: "flex", flexDirection: "column",
          gap: "16px", marginTop: "32px",
        }}>
          {topics.slice(0, 5).map((t, i) => (
            <div key={i} style={{ fontSize: "28px", color: "#44403c" }}>
              {String(i + 1).padStart(2, "0")}. {t.title}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: 1200, height: 630,
      ...(fontData
        ? { fonts: [{ name: "Noto Sans KR", data: fontData, style: "normal" as const, weight: 400 as const }] }
        : {}),
    },
  );
}
```

### 7-3. JSON-LD 구조화 데이터 (`src/components/JsonLd.tsx`)

각 날짜 페이지에 `NewsArticle` 타입의 JSON-LD를 삽입한다.

```typescript
import type { DailyTopic } from "@/lib/types";

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
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
      }}
    />
  );
}
```

메인/상세 페이지에서 토픽마다 `<TopicJsonLd />` 렌더링.

### 7-4. sitemap.xml 자동 생성 (`src/app/sitemap.ts`)

```typescript
import type { MetadataRoute } from "next";
import { supabase } from "@/lib/supabase";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await supabase
    .from("daily_topics")
    .select("date")
    .order("date", { ascending: false });

  const uniqueDates = [...new Set((data ?? []).map((d) => d.date))];

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://hot-topic-blog.vercel.app";

  return [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "daily" },
    { url: `${baseUrl}/archive`, lastModified: new Date(), changeFrequency: "daily" },
    ...uniqueDates.map((date) => ({
      url: `${baseUrl}/archive/${date}`,
      lastModified: new Date(date),
      changeFrequency: "never" as const,
    })),
  ];
}
```

---

## 8. 뉴스레터 스타일 디자인 가이드

### 8-1. 레이아웃 컨셉

```
+---------------------------------------------+
|                                             |
|    오늘의 핫토픽                              |
|    2026년 3월 28일 토요일                     |
|    AI가 매일 아침 선정하는 뉴스 브리핑          |
|                                             |
|    -----------------------------------------|
|                                             |
|    01                                       |
|    경제  한국은행 기준금리 동결                 |
|                                             |
|    요약 텍스트 3~5줄. 객관적 뉴스 브리핑        |
|    어조로 작성된 내용이 들어갑니다.              |
|    핵심 수치나 인용이 포함될 수 있습니다.        |
|                                             |
|    출처  조선일보 · 한경 · 연합뉴스            |
|                                             |
|    -----------------------------------------|
|                                             |
|    02                                       |
|    IT·테크  OpenAI, GPT-5 공개               |
|    ...                                      |
|                                             |
|    -----------------------------------------|
|                                             |
|    <- 어제 핫토픽          아카이브 보기 ->     |
|                                             |
+---------------------------------------------+
```

### 8-2. 스타일 원칙

- **최대 너비**: 640px 중앙 정렬 (이메일 뉴스레터와 동일한 가독성)
- **서체**: Noto Serif KR (본문, `--font-serif`), Geist Sans (UI, `--font-sans`), Geist Mono (코드, `--font-mono`)
- **색상**: 따뜻한 뉴트럴 계열 (stone), 라이트(`#fafaf9`) / 다크(`#0c0a09`) 배경
- **구분선**: 얇은 수평선으로 토픽 사이 구분 (border-stone-200)
- **번호 표기**: 01~05 큰 숫자로 시각적 앵커
- **여백**: 넉넉한 상하 패딩으로 콘텐츠 간 호흡
- **반응형**: 모바일에서도 동일한 단일 컬럼 레이아웃
- **다크모드**: CSS `prefers-color-scheme` + Tailwind `dark:` prefix로 대응

### 8-3. CSS 변수 (`src/app/globals.css`)

```css
@import "tailwindcss";

:root {
  --background: #fafaf9;
  --foreground: #1c1917;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --font-serif: var(--font-noto-serif-kr);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0c0a09;
    --foreground: #e7e5e4;
  }
}
```

### 8-4. 카테고리 색상 매핑

```typescript
export const categoryStyles: Record<string, string> = {
  정치: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  경제: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  사회: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  "IT·과학": "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  "IT·테크": "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
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
└── responsive.spec.ts         # 반응형 + 다크모드

playwright.config.ts           # 설정 (프로젝트 루트)
```

파이프라인(Edge Function) 테스트는 Supabase 대시보드 + pipeline_logs 테이블에서 확인한다. Playwright는 프론트엔드 UI 테스트에만 집중한다.

### 9-2. Playwright 설정

```typescript
// playwright.config.ts
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
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: "mobile",
      use: {
        browserName: "webkit",
        viewport: { width: 375, height: 812 },
      },
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

  test("날짜 클릭 -> 해당 날짜 페이지로 이동", async ({ page }) => {
    await page.goto("/archive");
    await page.locator("[data-testid='archive-date-item']").first().click();
    await expect(page).toHaveURL(/\/archive\/\d{4}-\d{2}-\d{2}/);
    await expect(
      page.locator("[data-testid='topic-card']").first(),
    ).toBeVisible();
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
| `NEXT_PUBLIC_SITE_URL` | 사이트 기본 URL (sitemap용, 선택) |

### Supabase Edge Function (Secrets)

| 변수명 | 용도 |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API 인증 |
| `NAVER_CLIENT_ID` | Naver 뉴스 검색 API 클라이언트 ID |
| `NAVER_CLIENT_SECRET` | Naver 뉴스 검색 API 클라이언트 시크릿 |

> `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Edge Function에서 자동 주입.

---

## 11. 작업 순서

### Phase 1 — 파이프라인 구축
1. Supabase MCP로 테이블, RLS 생성
2. Naver News API 연동 (naver.ts)
3. 키워드 빈도 분석 로직 작성 (topics.ts)
4. Claude 요약 프롬프트 작성 및 테스트 (prompts.ts)
5. Edge Function 파이프라인 통합 (pipeline.ts)
6. Zod 스키마 검증, 재시도 로직 확인
7. pg_cron + pg_net 스케줄 등록
8. 며칠간 자동 실행 모니터링 (pipeline_logs 확인)

### Phase 2 — 프론트엔드
9. Next.js 프로젝트에 Supabase 연동
10. 메인 페이지 (뉴스레터 스타일)
11. 아카이브 페이지
12. 반응형 + 다크모드
13. SEO: 메타태그, OG 이미지, JSON-LD, sitemap.xml

### Phase 3 — 테스트 & 배포
14. Playwright E2E 테스트 작성
15. Vercel 배포 + 환경변수 설정
16. GitHub Actions CI 파이프라인 설정
17. 프롬프트 품질 튜닝

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
| Naver News API | 무료 (일 25,000건 제한) |
| Claude API Sonnet (일 1회 호출 x 30일, ~2000 토큰/회) | ~$1 |
| **합계** | **~$1/월** |

> 이전 버전(Claude web_search 2회 호출)에서 **Naver API + 키워드 분석 + Claude 요약 1회**로 변경하여 비용을 대폭 절감.

---

## 13. 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| Naver API 응답 부실 / 할당량 초과 | 일 25,000건 제한 충분 (1,000건/회), 에러 시 pipeline_logs 기록 |
| 키워드 분석 품질 불균일 | 불용어 사전 지속 보강, 최소 3기사 등장 조건으로 노이즈 필터링 |
| Claude JSON 파싱 실패 | Zod 검증 + 최대 3회 재시도 (pipeline.ts) |
| Edge Function 400초 초과 | Naver API 10회 순차 호출이 병목 — 필요 시 병렬화 |
| 같은 토픽 연일 반복 | 키워드 빈도 분석이 당일 뉴스에 자연 집중, 필요 시 전일 키워드 제외 추가 |
| 출처 URL 깨짐 (404) | Naver API가 제공하는 실제 기사 URL 사용으로 신뢰성 향상 |
| pg_cron 실행 누락 | pipeline_logs 테이블에서 주기적 확인 |
