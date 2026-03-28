import type { MetadataRoute } from "next";
import { supabase } from "@/lib/supabase";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await supabase
    .from("daily_topics")
    .select("date")
    .order("date", { ascending: false });

  const uniqueDates = [...new Set((data ?? []).map((d) => d.date))];

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://hot-topic-blog.vercel.app";

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
    },
    {
      url: `${baseUrl}/archive`,
      lastModified: new Date(),
      changeFrequency: "daily",
    },
    ...uniqueDates.map((date) => ({
      url: `${baseUrl}/archive/${date}`,
      lastModified: new Date(date),
      changeFrequency: "never" as const,
    })),
  ];
}
