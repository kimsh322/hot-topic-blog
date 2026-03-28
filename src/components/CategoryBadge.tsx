import { getCategoryStyle } from "@/lib/types";

export function CategoryBadge({ category }: { category: string }) {
  const { badge } = getCategoryStyle(category);

  return (
    <span
      data-testid="category-badge"
      className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${badge}`}
    >
      {category}
    </span>
  );
}
