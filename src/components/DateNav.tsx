import Link from "next/link";

export function DateNav({
  prevDate,
  nextDate,
}: {
  prevDate: string | null;
  nextDate: string | null;
}) {
  return (
    <nav className="mt-16 border-t border-[var(--border)] pt-8">
      <div className="flex items-center justify-between">
        {prevDate ? (
          <Link
            href={`/archive/${prevDate}`}
            className="group flex items-center gap-2 text-sm text-[var(--muted)] transition-colors hover:text-stone-900 dark:hover:text-stone-100"
          >
            <span className="transition-transform group-hover:-translate-x-1">
              &larr;
            </span>
            이전 핫토픽
          </Link>
        ) : (
          <span />
        )}
        <Link
          href="/archive"
          className="group flex items-center gap-2 rounded-full border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] transition-all hover:border-stone-400 hover:text-stone-900 dark:hover:border-stone-500 dark:hover:text-stone-100"
        >
          아카이브
          <span className="transition-transform group-hover:translate-x-1">
            &rarr;
          </span>
        </Link>
      </div>
    </nav>
  );
}
