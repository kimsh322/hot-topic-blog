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
    <main className="mx-auto w-full max-w-[640px] px-4 py-12">
      <header className="mb-10">
        <Link
          href="/"
          className="text-sm text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
        >
          &larr; 오늘의 핫토픽
        </Link>
        <h1 className="mt-4 font-serif text-3xl font-bold text-stone-900 dark:text-stone-100">
          아카이브
        </h1>
        <hr className="mt-6 border-stone-200 dark:border-stone-800" />
      </header>

      {dates.length === 0 ? (
        <p className="py-20 text-center text-stone-400 dark:text-stone-500">
          아직 아카이브된 핫토픽이 없습니다.
        </p>
      ) : (
        <ul className="divide-y divide-stone-200 dark:divide-stone-800">
          {dates.map((date) => (
            <li key={date}>
              <Link
                data-testid="archive-date-item"
                href={`/archive/${date}`}
                className="block py-4 text-stone-700 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
              >
                {formatDateKR(date)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
