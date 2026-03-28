export function TopicSkeleton() {
  return (
    <div className="space-y-12">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="animate-pulse border-l-2 border-stone-200 pl-6 dark:border-stone-800">
          <div className="flex items-center gap-3">
            <div className="h-4 w-6 rounded bg-stone-200 dark:bg-stone-800" />
            <div className="h-5 w-14 rounded bg-stone-200 dark:bg-stone-800" />
          </div>
          <div className="mt-3 h-6 w-56 rounded bg-stone-200 dark:bg-stone-800" />
          <div className="mt-4 space-y-2">
            <div className="h-4 w-full rounded bg-stone-200 dark:bg-stone-800" />
            <div className="h-4 w-full rounded bg-stone-200 dark:bg-stone-800" />
            <div className="h-4 w-3/4 rounded bg-stone-200 dark:bg-stone-800" />
          </div>
          <div className="mt-4 space-y-1.5">
            <div className="h-3 w-16 rounded bg-stone-200 dark:bg-stone-800" />
            <div className="h-3 w-48 rounded bg-stone-200 dark:bg-stone-800" />
            <div className="h-3 w-40 rounded bg-stone-200 dark:bg-stone-800" />
          </div>
        </div>
      ))}
    </div>
  );
}
