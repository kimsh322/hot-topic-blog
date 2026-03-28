import { TopicSkeleton } from "@/components/TopicSkeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[640px] px-4 py-12">
      <div className="mb-10 animate-pulse space-y-2">
        <div className="h-4 w-20 rounded bg-stone-200 dark:bg-stone-800" />
        <div className="mt-4 h-9 w-48 rounded bg-stone-200 dark:bg-stone-800" />
        <div className="h-5 w-40 rounded bg-stone-200 dark:bg-stone-800" />
        <hr className="mt-6 border-stone-200 dark:border-stone-800" />
      </div>
      <TopicSkeleton />
    </main>
  );
}
