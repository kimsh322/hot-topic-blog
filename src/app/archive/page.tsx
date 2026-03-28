import type { Metadata } from "next";
import Link from "next/link";
import { getArchiveDates, formatDateKR } from "@/lib/queries";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "아카이브",
};

export default async function ArchivePage() {
  const { dates } = await getArchiveDates();

  return (
    <main className="mx-auto w-full max-w-[640px] px-5 py-16">
      <header className="mb-12 animate-fade-in">
        <Link
          href="/"
          className="group flex items-center gap-2 text-sm text-[var(--muted)] transition-colors hover:text-stone-900 dark:hover:text-stone-100"
        >
          <span className="transition-transform group-hover:-translate-x-1">
            &larr;
          </span>
          오늘의 핫토픽
        </Link>
        <h1 className="mt-6 font-serif text-4xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
          아카이브
        </h1>
        <div className="mt-8 flex gap-1">
          <span className="h-0.5 w-12 bg-stone-900 dark:bg-stone-100" />
          <span className="h-0.5 w-3 bg-stone-300 dark:bg-stone-700" />
          <span className="h-0.5 w-1.5 bg-stone-200 dark:bg-stone-800" />
        </div>
      </header>

      {dates.length === 0 ? (
        <p className="py-20 text-center text-[var(--muted)]">
          아직 아카이브된 핫토픽이 없습니다.
        </p>
      ) : (
        <ul className="space-y-1">
          {dates.map((date, i) => (
            <li
              key={date}
              className="animate-fade-in"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <Link
                data-testid="archive-date-item"
                href={`/archive/${date}`}
                className="group flex items-center justify-between rounded-lg px-4 py-3.5 transition-colors hover:bg-stone-100 dark:hover:bg-stone-900"
              >
                <span className="font-serif text-stone-700 dark:text-stone-300">
                  {formatDateKR(date)}
                </span>
                <span className="text-sm text-stone-300 transition-transform group-hover:translate-x-1 group-hover:text-stone-500 dark:text-stone-700 dark:group-hover:text-stone-400">
                  &rarr;
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
