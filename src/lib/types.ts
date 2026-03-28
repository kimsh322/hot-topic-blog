export interface Source {
  title: string;
  url: string;
}

export interface DailyTopic {
  id: string;
  date: string;
  topic_order: number;
  title: string;
  category: string;
  summary: string;
  keywords: string[];
  sources: Source[];
  created_at: string;
}

export type Category =
  | "정치"
  | "경제"
  | "사회"
  | "IT·과학"
  | "IT·테크"
  | "문화·스포츠";

export const categoryStyles: Record<
  string,
  { badge: string; accent: string }
> = {
  정치: {
    badge: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
    accent: "border-[var(--accent-politics)]",
  },
  경제: {
    badge: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    accent: "border-[var(--accent-economy)]",
  },
  사회: {
    badge: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    accent: "border-[var(--accent-society)]",
  },
  "IT·과학": {
    badge:
      "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
    accent: "border-[var(--accent-tech)]",
  },
  "IT·테크": {
    badge:
      "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
    accent: "border-[var(--accent-tech)]",
  },
  "문화·스포츠": {
    badge:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    accent: "border-[var(--accent-culture)]",
  },
};

const defaultStyle = {
  badge: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
  accent: "border-stone-300 dark:border-stone-700",
};

export function getCategoryStyle(category: string) {
  return categoryStyles[category] ?? defaultStyle;
}
