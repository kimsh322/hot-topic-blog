import type { DailyTopic } from "@/lib/types";
import { CategoryBadge } from "./CategoryBadge";
import { SourceLinks } from "./SourceLinks";

export function TopicCard({
  topic,
  index,
}: {
  topic: DailyTopic;
  index: number;
}) {
  return (
    <article data-testid="topic-card" className="space-y-3">
      <p className="font-sans text-4xl font-light text-stone-300 dark:text-stone-600">
        {String(index + 1).padStart(2, "0")}
      </p>
      <div className="flex items-center gap-2.5">
        <CategoryBadge category={topic.category} />
        <h2 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100">
          {topic.title}
        </h2>
      </div>
      <p
        data-testid="topic-summary"
        className="font-serif leading-relaxed text-stone-700 dark:text-stone-300"
      >
        {topic.summary}
      </p>
      <SourceLinks sources={topic.sources} />
    </article>
  );
}
