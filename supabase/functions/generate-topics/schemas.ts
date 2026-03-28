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

export function parseClaudeJSON<T>(raw: string, schema: z.ZodType<T>): T {
  const cleaned = raw.replace(/```json\n?|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  return schema.parse(parsed);
}
