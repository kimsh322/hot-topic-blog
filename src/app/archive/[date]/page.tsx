import type { Metadata } from "next";
import Link from "next/link";
import {
  getTopicsByDate,
  getAdjacentDates,
  getArchiveDates,
  formatDateKR,
} from "@/lib/queries";
import { NewsletterHeader } from "@/components/NewsletterHeader";
import { TopicCard } from "@/components/TopicCard";
import { TopicJsonLd } from "@/components/JsonLd";
import { DateNav } from "@/components/DateNav";

export const revalidate = 86400;

export async function generateStaticParams() {
  const { dates } = await getArchiveDates(1, 30);
  return dates.map((date) => ({ date }));
}

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

export default async function DateDetailPage(props: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await props.params;
  const [topics, { prev, next }] = await Promise.all([
    getTopicsByDate(date),
    getAdjacentDates(date),
  ]);

  return (
    <main className="mx-auto w-full max-w-[640px] px-5 py-16">
      <Link
        href="/archive"
        className="group flex items-center gap-2 text-sm text-[var(--muted)] transition-colors hover:text-stone-900 dark:hover:text-stone-100"
      >
        <span className="transition-transform group-hover:-translate-x-1">
          &larr;
        </span>
        아카이브
      </Link>

      <div className="mt-6">
        <NewsletterHeader date={date} />
      </div>

      {topics.length === 0 ? (
        <p className="py-20 text-center text-[var(--muted)]">
          해당 날짜의 핫토픽이 없습니다.
        </p>
      ) : (
        <div className="space-y-12">
          {topics.map((topic, i) => (
            <div key={topic.id}>
              <TopicCard topic={topic} index={i} />
              <TopicJsonLd topic={topic} date={date} />
            </div>
          ))}
        </div>
      )}

      <DateNav prevDate={prev} nextDate={next} />
    </main>
  );
}
