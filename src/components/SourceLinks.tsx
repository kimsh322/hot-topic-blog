import type { Source } from "@/lib/types";

export function SourceLinks({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-4 space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">
        관련 기사
      </p>
      <ul className="space-y-1">
        {sources.map((source, i) => (
          <li key={i}>
            <a
              data-testid="source-link"
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-2 text-sm text-stone-500 transition-colors hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
            >
              <span className="mt-1.5 block h-1 w-1 shrink-0 rounded-full bg-stone-300 transition-colors group-hover:bg-stone-500 dark:bg-stone-600 dark:group-hover:bg-stone-400" />
              <span className="underline-offset-2 group-hover:underline">
                {source.title}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
