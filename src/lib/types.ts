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

export const categoryStyles: Record<string, string> = {
  정치: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  경제: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  사회: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  "IT·과학":
    "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  "IT·테크":
    "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  "문화·스포츠":
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
};
