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
    // 1. 네이버 뉴스 500건 수집
    const newsItems = await fetchNaverNews();

    // 2. 키워드 빈도 분석으로 핫토픽 5개 자동 추출
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

    // 3. Claude로 요약 생성 (웹 검색 없음, 토큰 절약)
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

    // 4. DB 저장
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

    // 5. Vercel 캐시 갱신
    await revalidateVercel();

    // 6. 로그 기록
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

async function revalidateVercel() {
  const siteUrl = Deno.env.get("SITE_URL");
  const secret = Deno.env.get("REVALIDATE_SECRET");
  if (!siteUrl || !secret) return;

  try {
    await fetch(`${siteUrl}/api/revalidate`, {
      method: "POST",
      headers: { "x-revalidate-secret": secret },
    });
  } catch {
    // revalidation 실패해도 파이프라인은 성공으로 처리
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
