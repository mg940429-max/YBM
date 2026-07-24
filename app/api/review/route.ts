import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_GUIDE_BYTES = 10 * 1024 * 1024;
const ALLOWED_SOURCE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const ALLOWED_GUIDE_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);

type InputContent = Record<string, unknown>;

function dataUrl(file: File, bytes: ArrayBuffer) {
  return `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`;
}

function inputFile(file: File, bytes: ArrayBuffer, detail?: "high") {
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
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "output_text" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

export async function GET() {
  return NextResponse.json({ configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || "gpt-5.6-terra" });
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI 검수 API 키가 배포 환경에 등록되지 않았습니다." }, { status: 503 });

  try {
    const form = await request.formData();
    const source = form.get("file");
    const guide = form.get("guide");
    const grade = String(form.get("grade") ?? "").trim();
    const totalPages = Math.max(1, Math.min(100, Number(form.get("totalPages")) || 1));

    if (!(source instanceof File) || !grade) return NextResponse.json({ error: "검수 파일과 대상 학년을 확인해 주세요." }, { status: 400 });
    if (!ALLOWED_SOURCE_TYPES.has(source.type) || source.size > MAX_SOURCE_BYTES) {
      return NextResponse.json({ error: "문제 파일은 PDF·PNG·JPG·WEBP 형식, 최대 20MB까지 가능합니다." }, { status: 400 });
    }
    if (guide instanceof File && guide.size > 0 && (!ALLOWED_GUIDE_TYPES.has(guide.type) || guide.size > MAX_GUIDE_BYTES)) {
      return NextResponse.json({ error: "편집 기준은 PDF·DOCX·TXT 형식, 최대 10MB까지 가능합니다." }, { status: 400 });
    }

    const sourceBytes = await source.arrayBuffer();
    const userContent: InputContent[] = [
      source.type === "application/pdf"
        ? inputFile(source, sourceBytes, "high")
        : { type: "input_image", image_url: dataUrl(source, sourceBytes), detail: "high" },
    ];
    if (guide instanceof File && guide.size > 0) userContent.push(inputFile(guide, await guide.arrayBuffer()));
    userContent.push({
      type: "input_text",
      text: `검수 대상은 '${grade}'이고 원문은 총 ${totalPages}페이지입니다. 첫 번째 파일이 문제·풀이 원문이며 두 번째 파일이 있다면 내부 편집 통일 사항입니다. 페이지 번호는 반드시 1~${totalPages} 사이로만 보고하세요.`,
    });

    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["score", "summary", "items"],
      properties: {
        score: { type: "integer", minimum: 0, maximum: 100 },
        summary: { type: "string" },
        items: {
          type: "array",
          maxItems: 100,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["page", "type", "title", "description", "before", "after", "standard", "format"],
            properties: {
              page: { type: "integer", minimum: 1, maximum: totalPages },
              type: { type: "string", enum: ["curriculum", "style", "math", "scope"] },
              title: { type: "string" },
              description: { type: "string" },
              before: { type: "string" },
              after: { type: "string" },
              standard: { type: "string" },
              format: { type: "string", enum: ["text", "latex"] },
            },
          },
        },
      },
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
        reasoning: { effort: "high" },
        store: false,
        tools: [{ type: "web_search" }],
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: `당신은 대한민국 수학 교과서의 수학 검증자이자 교정·교열 전문가입니다. 첨부 원문의 모든 페이지와 모든 문항을 빠짐없이 확인하세요.

검수 절차:
1. 각 문항을 원문 풀이와 독립적으로 직접 풀고 정답, 선택지, 조건, 단위, 그래프, 도형, 정의역, 계산을 검산합니다.
2. 제시된 풀이의 각 논리 단계가 성립하는지 확인하고, 답은 맞더라도 잘못된 근거나 비약이 있으면 math로 보고합니다.
3. 선택한 '${grade}'의 2022 개정 수학과 교육과정 범위인지 확인합니다. 교육과정 판단이 필요하면 web_search로 ncic.re.kr의 공식 자료를 우선 확인하며, 학교급을 임의로 바꾸지 마세요.
4. 내부 편집 통일 사항 파일이 있으면 그 기준을 우선 적용합니다. 파일이 없으면 명확한 맞춤법·표기 오류만 style로 보고합니다.

분류:
- curriculum: 2022 개정 수학과 교육과정 또는 성취기준과 맞지 않음
- style: 내부 편집 통일 사항, 맞춤법, 용어, 문장부호 오류
- math: 계산, 정답, 조건, 선택지, 풀이 논리, 그래프·도형의 수학적 오류
- scope: 선택 학년·과목 범위를 벗어난 개념 또는 풀이 방법

보고 원칙:
- 실제 수정이 필요한 항목만 items에 넣고, 같은 오류를 중복 보고하지 마세요.
- 확신할 수 없는 OCR 추정이나 단순 취향은 오류로 만들지 마세요.
- before는 원문의 잘못된 부분을 정확히 옮기고 after는 바로 교체 가능한 수정안으로 씁니다.
- 수식 중심의 before/after는 올바른 LaTeX를 $...$로 감싸고 format을 latex로 지정합니다. 한국어 문장은 format을 text로 지정합니다.
- 오류가 하나도 없을 때만 items를 빈 배열로 반환합니다. summary에는 검증한 문항과 핵심 판단을 한국어로 간결하게 설명합니다.`,
            }],
          },
          { role: "user", content: userContent },
        ],
        text: { format: { type: "json_schema", name: "math_review_report", strict: true, schema } },
        max_output_tokens: 16000,
      }),
    });

    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const apiError = payload.error && typeof payload.error === "object" ? payload.error as { message?: unknown } : null;
      const message = typeof apiError?.message === "string" ? apiError.message : "OpenAI API 검수 요청에 실패했습니다.";
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const outputText = extractOutputText(payload);
    if (!outputText) return NextResponse.json({ error: "AI가 검수 결과를 반환하지 않았습니다. 다시 시도해 주세요." }, { status: 502 });
    const report = JSON.parse(outputText) as { score?: unknown; summary?: unknown; items?: unknown };
    const items = Array.isArray(report.items)
      ? report.items
          .map((item, index) => ({ ...(item as Record<string, unknown>), id: index + 1 }) as Record<string, unknown> & { id: number })
          .filter((item) => Number(item.page) >= 1 && Number(item.page) <= totalPages)
      : [];
    return NextResponse.json({ score: Math.max(0, Math.min(100, Number(report.score) || 0)), summary: String(report.summary ?? "AI 정밀 검수가 완료되었습니다."), items });
  } catch {
    return NextResponse.json({ error: "문서를 AI로 검수하는 중 문제가 발생했습니다. 파일 형식과 크기를 확인한 뒤 다시 시도해 주세요." }, { status: 500 });
  }
}
