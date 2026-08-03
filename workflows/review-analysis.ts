import { del, get } from "@vercel/blob";
import { analyzeReviewFiles } from "../app/api/review/route";

export type ReviewWorkflowInput = {
  source: { url: string; name: string; type: string; size: number };
  guide?: { url: string; name: string; type: string; size: number };
  subject: string;
  grade: string;
  totalPages: number;
};

type ReviewWorkflowResult = Record<string, unknown>;

async function readPrivateBlob(blob: ReviewWorkflowInput["source"]) {
  const result = await get(blob.url, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error(`${blob.name} 파일을 임시 저장소에서 읽지 못했습니다.`);
  }
  const bytes = await new Response(result.stream).arrayBuffer();
  return new File([bytes], blob.name, { type: blob.type });
}

async function executeReview(input: ReviewWorkflowInput): Promise<ReviewWorkflowResult> {
  "use step";
  const source = await readPrivateBlob(input.source);
  const guide = input.guide ? await readPrivateBlob(input.guide) : undefined;
  const response = await analyzeReviewFiles({
    source,
    guide,
    subject: input.subject,
    grade: input.grade,
    totalPages: input.totalPages,
  });
  const payload = await response.json() as ReviewWorkflowResult & { error?: string };
  if (!response.ok) throw new Error(payload.error || "AI 모의 심사에 실패했습니다.");
  return payload;
}

async function removeTemporaryFiles(urls: string[]) {
  "use step";
  await Promise.allSettled(urls.map((url) => del(url)));
}

export async function reviewAnalysisWorkflow(input: ReviewWorkflowInput): Promise<ReviewWorkflowResult> {
  "use workflow";
  try {
    return await executeReview(input);
  } finally {
    await removeTemporaryFiles([input.source.url, ...(input.guide ? [input.guide.url] : [])]);
  }
}
