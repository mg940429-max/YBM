import type { Metadata } from "next";
import { headers } from "next/headers";
import "katex/dist/katex.min.css";
import "./globals.css";

const title = "YBM 교과서 AI 모의 심사";
const description = "교정·교열, 수학적 정확성, 2022 개정 교육과정과 검정 심사 기준 적합성을 페이지별로 모의 심사합니다.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    title,
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title, description, type: "website", images: [{ url: `${origin}/og-suite.png`, width: 1736, height: 909, alt: "YBM 교과서 AI 모의 심사" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og-suite.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
