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
