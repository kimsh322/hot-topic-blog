import { categoryStyles } from "@/lib/types";

export function CategoryBadge({ category }: { category: string }) {
  const style =
    categoryStyles[category] ??
    "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300";

  return (
    <span
      data-testid="category-badge"
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}
    >
      {category}
    </span>
  );
}
