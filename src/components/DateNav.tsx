import Link from "next/link";

export function DateNav({ currentDate }: { currentDate: string | null }) {
  const prevDate = currentDate ? getPreviousDate(currentDate) : null;

  return (
    <nav className="mt-12 flex items-center justify-between border-t border-stone-200 pt-6 text-sm dark:border-stone-800">
      {prevDate ? (
        <Link
          href={`/archive/${prevDate}`}
          className="text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
        >
          &larr; 어제 핫토픽
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

function getPreviousDate(dateString: string): string {
  const date = new Date(dateString + "T00:00:00+09:00");
  date.setDate(date.getDate() - 1);
  return date.toISOString().split("T")[0];
}
