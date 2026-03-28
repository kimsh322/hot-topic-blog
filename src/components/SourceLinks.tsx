import type { Source } from "@/lib/types";

export function SourceLinks({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;

  return (
    <p className="text-sm text-stone-500 dark:text-stone-400">
      <span className="font-medium">출처</span>{" "}
      {sources.map((source, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-1">&middot;</span>}
          <a
            data-testid="source-link"
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-stone-700 dark:hover:text-stone-200"
          >
            {source.title}
          </a>
        </span>
      ))}
    </p>
  );
}
