import type { DailyTopic } from "@/lib/types";

export function TopicJsonLd({
  topic,
  date,
}: {
  topic: DailyTopic;
  date: string;
}) {
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
