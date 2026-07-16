import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_GUIDE_BYTES = 8 * 1024 * 1024;
const ALLOWED_SOURCE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const ALLOWED_GUIDE_TYPES = new Set([
  "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain", "text/markdown",
]);

type InputContent = Record<string, unknown>;

function dataUrl(file: File, bytes: ArrayBuffer) {
  return `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`;
}

function fileInput(file: File, bytes: ArrayBuffer, detail?: "high") {
  return {
    type: "input_file",
    filename: file.name,
    file_data: dataUrl(file, bytes),
    ...(detail ? { detail } : {}),
  };
}

function extractOutputText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "output_text" && typeof (part as { text?: unknown }).text === "string") return (part as { text: string }).text;
    }
  }
  return "";
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI 분석 API가 아직 설정되지 않았습니다. 관리자에게 OPENAI_API_KEY 설정을 요청해 주세요." }, { status: 503 });

  try {
    const form = await request.formData();
    const source = form.get("file");
    const guide = form.get("guide");
    const grade = String(form.get("grade") ?? "").trim();
    const totalPages = Math.max(1, Math.min(100, Number(form.get("totalPages")) || 1));
    if (!(source instanceof File) || !grade) return NextResponse.json({ error: "검수 파일과 학년을 확인해 주세요." }, { status: 400 });
    if (!ALLOWED_SOURCE_TYPES.has(source.type) || source.size > MAX_SOURCE_BYTES) return NextResponse.json({ error: "PDF·PNG·JPG·WEBP 파일만 가능하며 최대 크기는 15MB입니다." }, { status: 400 });
    if (guide instanceof File && guide.size > 0 && (!ALLOWED_GUIDE_TYPES.has(guide.type) || guide.size > MAX_GUIDE_BYTES)) return NextResponse.json({ error: "편집 기준은 PDF·DOCX·TXT 형식, 최대 8MB까지 가능합니다." }, { status: 400 });

    const sourceBytes = await source.arrayBuffer();
    const userContent: InputContent[] = [
      source.type === "application/pdf"
        ? fileInput(source, sourceBytes, "high")
        : { type: "input_image", image_url: dataUrl(source, sourceBytes), detail: "high" },
    ];
    if (guide instanceof File && guide.size > 0) userContent.push(fileInput(guide, await guide.arrayBuffer()));
    userContent.push({
      type: "input_text",
      text: `검수 대상은 '${grade}'이며 문서 전체는 ${totalPages}페이지입니다. 첨부한 첫 번째 파일이 검수 대상이고, 두 번째 파일이 있다면 내부 편집 통일 사항입니다. 페이지 번호는 반드시 1부터 ${totalPages} 사이로만 보고하세요.`,
    });

    const schema = {
      type: "object", additionalProperties: false,
      required: ["score", "summary", "items"],
      properties: {
        score: { type: "integer", minimum: 0, maximum: 100 },
        summary: { type: "string" },
        items: {
          type: "array", maxItems: 80,
          items: {
            type: "object", additionalProperties: false,
            required: ["page", "type", "title", "description", "before", "after", "standard"],
            properties: {
              page: { type: "integer", minimum: 1, maximum: totalPages },
              type: { type: "string", enum: ["curriculum", "style", "math", "scope"] },
              title: { type: "string" }, description: { type: "string" },
              before: { type: "string" }, after: { type: "string" }, standard: { type: "string" },
            },
          },
        },
      },
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
        reasoning: { effort: "medium" },
        tools: [{ type: "web_search" }],
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: `당신은 대한민국 수학 교과서 전문 교정·교열자입니다. 첨부 문서의 모든 페이지를 OCR로 읽고 수식, 문제, 선택지, 풀이, 정답을 검증하세요.

다음 네 항목만 보고하세요.
1) curriculum: 2022 개정 수학과 교육과정과의 정합성
2) style: 첨부된 내부 편집 통일 사항 위반(기준 파일이 없으면 이 유형은 보고하지 않음)
3) math: 계산, 논리, 수식, 정답의 수학적 오류
4) scope: 선택한 학년·과목 범위를 벗어난 개념이나 풀이

교육과정 판단 시 웹 검색으로 ncic.re.kr의 공식 자료를 우선 확인하세요. 확인되지 않은 성취기준 코드를 만들어내지 마세요. 실제로 수정이 필요한 항목만 items에 넣고, 이상이 없는 유형은 0건으로 두세요. before에는 원문의 문제 부분을 짧고 정확하게 옮기고 after에는 바로 사용할 수 있는 수정안을 작성하세요. 같은 오류를 중복 보고하지 말고 한국어로 답하세요.` }],
          },
          { role: "user", content: userContent },
        ],
        text: { format: { type: "json_schema", name: "math_review_report", strict: true, schema } },
        max_output_tokens: 12000,
      }),
    });

    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof (payload.error as { message?: unknown } | undefined)?.message === "string" ? String((payload.error as { message: string }).message) : "AI 분석 요청에 실패했습니다.";
      return NextResponse.json({ error: message }, { status: response.status });
    }
    const text = extractOutputText(payload);
    if (!text) return NextResponse.json({ error: "AI가 검수 결과를 반환하지 않았습니다." }, { status: 502 });
    const report = JSON.parse(text) as { score?: unknown; summary?: unknown; items?: unknown };
    const items = Array.isArray(report.items) ? report.items.map((item, index) => ({ ...(item as Record<string, unknown>), id: index + 1 })).filter((item) => Number(item.page) >= 1 && Number(item.page) <= totalPages) : [];
    return NextResponse.json({ score: Number(report.score) || 0, summary: String(report.summary ?? ""), items });
  } catch {
    return NextResponse.json({ error: "문서를 분석하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
