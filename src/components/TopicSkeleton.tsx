export function TopicSkeleton() {
  return (
    <div className="space-y-10">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="animate-pulse space-y-3">
          <div className="h-10 w-12 rounded bg-stone-200 dark:bg-stone-800" />
          <div className="flex items-center gap-3">
            <div className="h-5 w-16 rounded-full bg-stone-200 dark:bg-stone-800" />
            <div className="h-6 w-48 rounded bg-stone-200 dark:bg-stone-800" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-full rounded bg-stone-200 dark:bg-stone-800" />
            <div className="h-4 w-full rounded bg-stone-200 dark:bg-stone-800" />
            <div className="h-4 w-3/4 rounded bg-stone-200 dark:bg-stone-800" />
          </div>
          <div className="h-4 w-56 rounded bg-stone-200 dark:bg-stone-800" />
          {i < 4 && (
            <hr className="mt-6 border-stone-200 dark:border-stone-800" />
          )}
        </div>
      ))}
    </div>
  );
}
