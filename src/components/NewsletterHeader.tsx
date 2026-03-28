import { formatDateKR } from "@/lib/queries";

export function NewsletterHeader({ date }: { date: string | null }) {
  return (
    <header className="mb-12 animate-fade-in">
      <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
        <span className="inline-block h-px w-8 bg-[var(--muted)]" />
        Daily Briefing
      </div>
      <h1 className="mt-4 font-serif text-4xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
        오늘의 핫토픽
      </h1>
      {date && (
        <p
          data-testid="display-date"
          className="mt-2 text-lg text-[var(--muted)]"
        >
          {formatDateKR(date)}
        </p>
      )}
      <p className="mt-1 text-sm text-stone-400 dark:text-stone-500">
        매일 아침, 뉴스 1000건을 분석하여 선정한 핫토픽 5
      </p>
      <div className="mt-8 flex gap-1">
        <span className="h-0.5 w-12 bg-stone-900 dark:bg-stone-100" />
        <span className="h-0.5 w-3 bg-stone-300 dark:bg-stone-700" />
        <span className="h-0.5 w-1.5 bg-stone-200 dark:bg-stone-800" />
      </div>
    </header>
  );
}
