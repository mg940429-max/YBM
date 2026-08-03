import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { reviewAnalysisWorkflow, type ReviewWorkflowInput } from "../../../../workflows/review-analysis";
import { reviewAccessGranted } from "../access";

const ALLOWED_SOURCE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const ALLOWED_GUIDE_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);

function validBlob(value: unknown, allowedTypes: Set<string>, maxBytes: number) {
  if (!value || typeof value !== "object") return false;
  const blob = value as Record<string, unknown>;
  return typeof blob.url === "string"
    && blob.url.includes(".blob.vercel-storage.com/")
    && typeof blob.name === "string"
    && allowedTypes.has(String(blob.type))
    && Number(blob.size) > 0
    && Number(blob.size) <= maxBytes;
}

export async function POST(request: Request) {
  if (!reviewAccessGranted(request)) {
    return NextResponse.json({ error: "사용 권한 코드를 확인해 주세요." }, { status: 401 });
  }
  const blobConfigured = Boolean(
    process.env.BLOB_READ_WRITE_TOKEN
      || (process.env.BLOB_STORE_ID && process.env.BLOB_WEBHOOK_PUBLIC_KEY),
  );
  if (!process.env.OPENAI_API_KEY || !blobConfigured) {
    return NextResponse.json({ error: "배포 환경의 AI 또는 파일 저장 설정이 완료되지 않았습니다." }, { status: 503 });
  }

  try {
    const input = await request.json() as ReviewWorkflowInput;
    if (input.subject !== "수학" || !input.grade || !Number.isInteger(input.totalPages) || input.totalPages < 1 || input.totalPages > 100) {
      return NextResponse.json({ error: "과목, 학년 또는 페이지 정보를 확인해 주세요." }, { status: 400 });
    }
    if (!validBlob(input.source, ALLOWED_SOURCE_TYPES, 50_000_000)) {
      return NextResponse.json({ error: "교과서 업로드 정보를 확인해 주세요." }, { status: 400 });
    }
    if (input.guide && !validBlob(input.guide, ALLOWED_GUIDE_TYPES, 10 * 1024 * 1024)) {
      return NextResponse.json({ error: "편집 기준 업로드 정보를 확인해 주세요." }, { status: 400 });
    }
    if (input.source.size + (input.guide?.size ?? 0) > 50_000_000) {
      return NextResponse.json({ error: "업로드 파일 합계는 최대 50MB입니다." }, { status: 400 });
    }

    const run = await start(reviewAnalysisWorkflow, [input]);
    return NextResponse.json({ runId: run.runId, status: "queued" }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "분석 작업을 시작하지 못했습니다." },
      { status: 500 },
    );
  }
}
