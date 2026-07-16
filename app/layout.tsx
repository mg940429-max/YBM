import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "수학검수 AI | 수학 문제 교정·교열";
const description = "2022 개정 수학과 교육과정과 내부 편집 기준에 따라 수학 문제를 검수하고 수정안을 제안합니다.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    title,
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title, description, type: "website", images: [{ url: `${origin}/og.png`, width: 1736, height: 909, alt: "수학검수 AI" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
