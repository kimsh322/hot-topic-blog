interface NewsItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

export interface HotTopic {
  keywords: string[];
  count: number;
  articles: NewsItem[];
}

const STOPWORDS = new Set([
  "뉴스", "오늘", "기자", "제공", "관련", "대한", "이번", "통해", "위해",
  "것으로", "으로", "에서", "대해", "한다", "있다", "했다", "된다", "하는", "있는",
  "라며", "이라고", "인사", "포토", "사진", "영상", "속보", "종합", "단독", "업데이트",
  "quot", "amp",
  "연합뉴스", "헤럴드경제", "한겨레", "한국경제", "매일경제", "조선일보", "중앙일보",
  "서울", "부산", "대전", "대구", "광주", "제주", "경기", "전국", "지역",
  "대표", "위원", "의원", "장관", "시장", "전면", "이상", "이후", "이전", "올해",
  "지난해", "현재", "내년", "최근", "이날",
]);

export function extractHotTopics(
  newsItems: NewsItem[],
  topicCount = 10,
): HotTopic[] {
  // 각 기사에서 키워드 추출
  const articleKeywords: string[][] = newsItems.map((item) => {
    const words = item.title.match(/[가-힣A-Za-z0-9]{2,}/g) ?? [];
    return [...new Set(words.filter((w) => !STOPWORDS.has(w)))];
  });

  // 2-키워드 조합 빈도 계산
  const pairCounts = new Map<string, number>();
  const pairArticles = new Map<string, number[]>();

  for (let i = 0; i < articleKeywords.length; i++) {
    const words = articleKeywords[i];
    for (let a = 0; a < words.length; a++) {
      for (let b = a + 1; b < words.length; b++) {
        const pair = [words[a], words[b]].sort().join("|");
        pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
        if (!pairArticles.has(pair)) pairArticles.set(pair, []);
        pairArticles.get(pair)!.push(i);
      }
    }
  }

  // 빈도순 정렬
  const sorted = [...pairCounts.entries()].sort((a, b) => b[1] - a[1]);

  // 핫토픽 추출 (키워드 겹침 방지)
  const usedIndices = new Set<number>();
  const usedKeywords = new Set<string>();
  const topics: HotTopic[] = [];

  for (const [pair, count] of sorted) {
    if (topics.length >= topicCount) break;

    const [kw1, kw2] = pair.split("|");
    if (usedKeywords.has(kw1) || usedKeywords.has(kw2)) continue;

    const indices = pairArticles
      .get(pair)!
      .filter((i) => !usedIndices.has(i));

    if (indices.length >= 3) {
      const articles = indices.slice(0, 5).map((i) => newsItems[i]);
      for (const i of indices) usedIndices.add(i);
      usedKeywords.add(kw1);
      usedKeywords.add(kw2);
      topics.push({ keywords: [kw1, kw2], count, articles });
    }
  }

  return topics;
}
