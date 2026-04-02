import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Serif_KR } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSerifKR = Noto_Serif_KR({
  variable: "--font-noto-serif-kr",
  weight: ["400", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://hot-topic-blog.vercel.app"),
  title: {
    default: "오늘의 핫토픽 — AI 뉴스 브리핑",
    template: "%s | 오늘의 핫토픽",
  },
  description:
    "매일 아침 뉴스 1000건을 분석하여 핫토픽 5개를 선정하고 AI가 요약합니다.",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "오늘의 핫토픽",
    images: ["/og"],
  },
  alternates: {
    canonical: "https://hot-topic-blog.vercel.app",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSerifKR.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
