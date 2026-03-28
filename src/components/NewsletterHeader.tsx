import { formatDateKR } from "@/lib/queries";

export function NewsletterHeader({ date }: { date: string | null }) {
  return (
    <header className="mb-10">
      <h1 className="font-serif text-3xl font-bold text-stone-900 dark:text-stone-100">
        오늘의 핫토픽
      </h1>
      {date && (
        <p
          data-testid="display-date"
          className="mt-1 text-stone-500 dark:text-stone-400"
        >
          {formatDateKR(date)}
        </p>
      )}
      <p className="mt-1 text-sm text-stone-400 dark:text-stone-500">
        AI가 매일 아침 선정하는 뉴스 브리핑
      </p>
      <hr className="mt-6 border-stone-200 dark:border-stone-800" />
    </header>
  );
}
