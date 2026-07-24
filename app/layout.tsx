import type { Metadata } from "next";
import { headers } from "next/headers";
import "katex/dist/katex.min.css";
import "./globals.css";

const title = "수학도구 AI | 수학 문제 검수와 PDF 나누기";
const description = "2022 개정 교육과정 기반 수학 문제 검수와 안전한 브라우저 PDF 분할을 한곳에서 이용하세요.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    title,
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title, description, type: "website", images: [{ url: `${origin}/og-suite.png`, width: 1736, height: 909, alt: "수학도구 AI" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og-suite.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
