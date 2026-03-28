interface NaverNewsItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

export async function fetchNaverNews(): Promise<NaverNewsItem[]> {
  const clientId = Deno.env.get("NAVER_CLIENT_ID");
  const clientSecret = Deno.env.get("NAVER_CLIENT_SECRET");
  const allItems: NaverNewsItem[] = [];

  // 1000건 수집 (10회 호출)
  for (let page = 0; page < 10; page++) {
    const start = page * 100 + 1;
    const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent("뉴스")}&display=100&start=${start}&sort=date`;

    const response = await fetch(url, {
      headers: {
        "X-Naver-Client-Id": clientId!,
        "X-Naver-Client-Secret": clientSecret!,
      },
    });

    if (!response.ok) {
      throw new Error(`Naver API error: ${response.status}`);
    }

    const data = await response.json();

    for (const item of data.items) {
      allItems.push({
        title: cleanHtml(item.title),
        link: item.link,
        description: cleanHtml(item.description),
        pubDate: item.pubDate,
      });
    }
  }

  return allItems;
}

function cleanHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
