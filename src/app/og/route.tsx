import { ImageResponse } from "next/og";
import { getTopicsByDate, getLatestTopics, formatDateKR } from "@/lib/queries";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  const topics = date
    ? await getTopicsByDate(date)
    : (await getLatestTopics()).topics;

  const displayDate = date ?? new Date().toISOString().split("T")[0];

  let fontData: ArrayBuffer | undefined;
  try {
    const res = await fetch(
      "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-kr@latest/korean-400-normal.ttf",
    );
    if (res.ok) fontData = await res.arrayBuffer();
  } catch {
    // 폰트 로드 실패 시 시스템 폰트로 폴백
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          padding: "60px",
          backgroundColor: "#fafaf9",
          fontFamily: "Noto Sans KR",
        }}
      >
        <div style={{ fontSize: "28px", color: "#78716c" }}>
          {formatDateKR(displayDate)}
        </div>
        <div
          style={{ fontSize: "48px", fontWeight: 700, marginTop: "12px", color: "#1c1917" }}
        >
          오늘의 핫토픽
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            marginTop: "32px",
          }}
        >
          {topics.slice(0, 5).map((t, i) => (
            <div key={i} style={{ fontSize: "28px", color: "#44403c" }}>
              {String(i + 1).padStart(2, "0")}. {t.title}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      ...(fontData
        ? {
            fonts: [
              {
                name: "Noto Sans KR",
                data: fontData,
                style: "normal" as const,
                weight: 400 as const,
              },
            ],
          }
        : {}),
    },
  );
}
