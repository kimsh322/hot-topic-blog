import Link from "next/link";

export function DateNav({
  prevDate,
  nextDate,
}: {
  prevDate: string | null;
  nextDate: string | null;
}) {
  return (
    <nav className="mt-12 flex items-center justify-between border-t border-stone-200 pt-6 text-sm dark:border-stone-800">
      {prevDate ? (
        <Link
          href={`/archive/${prevDate}`}
          className="text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
        >
          &larr; 이전 핫토픽
        </Link>
      ) : (
        <span />
      )}
      <Link
        href="/archive"
        className="text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
      >
        아카이브 보기 &rarr;
      </Link>
    </nav>
  );
}
