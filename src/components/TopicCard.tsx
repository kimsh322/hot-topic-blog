import type { DailyTopic } from "@/lib/types";
import { getCategoryStyle } from "@/lib/types";
import { CategoryBadge } from "./CategoryBadge";
import { SourceLinks } from "./SourceLinks";

export function TopicCard({
  topic,
  index,
}: {
  topic: DailyTopic;
  index: number;
}) {
  const { accent } = getCategoryStyle(topic.category);

  return (
    <article
      data-testid="topic-card"
      className={`animate-fade-in border-l-2 pl-6 ${accent}`}
      style={{ animationDelay: `${index * 100}ms` }}
    >
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-sm font-medium text-[var(--muted)]">
          {String(index + 1).padStart(2, "0")}
        </span>
        <CategoryBadge category={topic.category} />
      </div>
      <h2 className="mt-2 font-serif text-xl font-bold leading-snug text-stone-900 dark:text-stone-50">
        {topic.title}
      </h2>
      <p
        data-testid="topic-summary"
        className="mt-3 font-serif text-[15px] leading-relaxed text-stone-600 dark:text-stone-400"
      >
        {topic.summary}
      </p>
      <SourceLinks sources={topic.sources} />
    </article>
  );
}
