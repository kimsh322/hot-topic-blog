import { supabase } from "./supabase";
import type { DailyTopic } from "./types";

export async function getTopicsByDate(date: string): Promise<DailyTopic[]> {
  try {
    const { data, error } = await supabase
      .from("daily_topics")
      .select("*")
      .eq("date", date)
      .order("topic_order", { ascending: true });

    if (error) throw error;
    return data ?? [];
  } catch (error) {
    console.error("[getTopicsByDate] Failed:", error);
    return [];
  }
}

export async function getLatestTopics(): Promise<{
  topics: DailyTopic[];
  date: string | null;
}> {
  try {
    const { data } = await supabase
      .from("daily_topics")
      .select("date")
      .order("date", { ascending: false })
      .limit(1)
      .single();

    if (!data) return { topics: [], date: null };

    const topics = await getTopicsByDate(data.date);
    return { topics, date: data.date };
  } catch (error) {
    console.error("[getLatestTopics] Failed:", error);
    return { topics: [], date: null };
  }
}

export async function getArchiveDates(
  page = 1,
  perPage = 20,
): Promise<{ dates: string[]; total: number }> {
  try {
    const { data, error } = await supabase
      .from("daily_topics")
      .select("date")
      .order("date", { ascending: false });

    if (error) throw error;

    const uniqueDates = [...new Set((data ?? []).map((d) => d.date))];
    const start = (page - 1) * perPage;

    return {
      dates: uniqueDates.slice(start, start + perPage),
      total: uniqueDates.length,
    };
  } catch (error) {
    console.error("[getArchiveDates] Failed:", error);
    return { dates: [], total: 0 };
  }
}

export async function getAdjacentDates(
  date: string,
): Promise<{ prev: string | null; next: string | null }> {
  try {
    const [prevResult, nextResult] = await Promise.all([
      supabase
        .from("daily_topics")
        .select("date")
        .lt("date", date)
        .order("date", { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from("daily_topics")
        .select("date")
        .gt("date", date)
        .order("date", { ascending: true })
        .limit(1)
        .single(),
    ]);

    return {
      prev: prevResult.data?.date ?? null,
      next: nextResult.data?.date ?? null,
    };
  } catch {
    return { prev: null, next: null };
  }
}

export function formatDateKR(dateString: string): string {
  const date = new Date(dateString + "T00:00:00+09:00");
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Seoul",
  }).format(date);
}
