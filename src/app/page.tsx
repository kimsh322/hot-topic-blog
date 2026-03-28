import { getLatestTopics, getAdjacentDates } from "@/lib/queries";
import { NewsletterHeader } from "@/components/NewsletterHeader";
import { TopicCard } from "@/components/TopicCard";
import { TopicJsonLd } from "@/components/JsonLd";
import { DateNav } from "@/components/DateNav";

export const revalidate = 86400;

export default async function Home() {
  const { topics, date } = await getLatestTopics();
  const { prev, next } = date
    ? await getAdjacentDates(date)
    : { prev: null, next: null };

  return (
    <main className="mx-auto w-full max-w-[640px] px-5 py-16">
      <NewsletterHeader date={date} />

      {topics.length === 0 ? (
        <p className="py-20 text-center text-[var(--muted)]">
          아직 오늘의 핫토픽이 준비되지 않았습니다.
        </p>
      ) : (
        <div className="space-y-12">
          {topics.map((topic, i) => (
            <div key={topic.id}>
              <TopicCard topic={topic} index={i} />
              <TopicJsonLd topic={topic} date={date!} />
            </div>
          ))}
        </div>
      )}

      <DateNav prevDate={prev} nextDate={next} />
    </main>
  );
}
