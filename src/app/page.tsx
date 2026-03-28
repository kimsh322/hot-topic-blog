import { getLatestTopics } from "@/lib/queries";
import { NewsletterHeader } from "@/components/NewsletterHeader";
import { TopicCard } from "@/components/TopicCard";
import { TopicJsonLd } from "@/components/JsonLd";
import { DateNav } from "@/components/DateNav";

export const revalidate = 86400;

export default async function Home() {
  const { topics, date } = await getLatestTopics();

  return (
    <main className="mx-auto w-full max-w-[640px] px-4 py-12">
      <NewsletterHeader date={date} />

      {topics.length === 0 ? (
        <p className="py-20 text-center text-stone-400 dark:text-stone-500">
          아직 오늘의 핫토픽이 준비되지 않았습니다.
        </p>
      ) : (
        <div className="space-y-10">
          {topics.map((topic, i) => (
            <div key={topic.id}>
              <TopicCard topic={topic} index={i} />
              <TopicJsonLd topic={topic} date={date!} />
              {i < topics.length - 1 && (
                <hr className="mt-10 border-stone-200 dark:border-stone-800" />
              )}
            </div>
          ))}
        </div>
      )}

      <DateNav currentDate={date} />
    </main>
  );
}
