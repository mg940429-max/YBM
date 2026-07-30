import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_GUIDE_BYTES = 10 * 1024 * 1024;
const NCIC_URL = "https://ncic.re.kr/inv/org/list.do";
const KOSAC_URL = "https://www.kosac.re.kr/menus/270/boards/386/posts/39295";
const ALLOWED_SOURCE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const ALLOWED_GUIDE_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
]);
const ALLOWED_SCOPES = new Set(["all", "proofreading", "screening"]);

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
  return NextResponse.json(
    { configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || "gpt-5.6-terra" },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } },
  );
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI 점검 API 키가 배포 환경에 등록되지 않았습니다." }, { status: 503 });

  try {
    const form = await request.formData();
    const source = form.get("file");
    const guide = form.get("guide");
    const subject = String(form.get("subject") ?? "").trim();
    const grade = String(form.get("grade") ?? "").trim();
    const requestedScope = String(form.get("reviewScope") ?? "all").trim();
    const reviewScope = ALLOWED_SCOPES.has(requestedScope) ? requestedScope : "all";
    const totalPages = Math.max(1, Math.min(100, Number(form.get("totalPages")) || 1));

    if (!(source instanceof File) || subject !== "수학" || !grade) {
      return NextResponse.json({ error: "수학 과목, 대상 학년과 점검 파일을 확인해 주세요." }, { status: 400 });
    }
    if (!ALLOWED_SOURCE_TYPES.has(source.type) || source.size > MAX_SOURCE_BYTES) {
      return NextResponse.json({ error: "교과서 파일은 PDF·PNG·JPG·WEBP 형식, 최대 20MB까지 가능합니다." }, { status: 400 });
    }
    if (guide instanceof File && guide.size > 0 && (!ALLOWED_GUIDE_TYPES.has(guide.type) || guide.size > MAX_GUIDE_BYTES)) {
      return NextResponse.json({ error: "편집 기준은 PDF·DOCX·TXT 형식, 최대 10MB까지 가능합니다." }, { status: 400 });
    }

    const scopeInstruction = reviewScope === "proofreading"
      ? "교정·교열, 내부 편집 기준, 수학적 정확성만 점검한다. screening·curriculum·scope 항목은 생성하지 않는다."
      : reviewScope === "screening"
        ? "검정 심사 적합성, 2022 개정 수학과 교육과정과 학년·과목 범위만 점검한다. math·style 항목은 생성하지 않는다."
        : "교정·교열과 검정 교육과정 적합성의 모든 유형을 통합 점검한다.";

    const sourceBytes = await source.arrayBuffer();
    const userContent: InputContent[] = [
      source.type === "application/pdf"
        ? inputFile(source, sourceBytes, "high")
        : { type: "input_image", image_url: dataUrl(source, sourceBytes), detail: "high" },
    ];
    if (guide instanceof File && guide.size > 0) userContent.push(inputFile(guide, await guide.arrayBuffer()));
    userContent.push({
      type: "input_text",
      text: [
        `대상은 '${grade}' '${subject}' 교과서이고 원문은 총 ${totalPages}페이지입니다.`,
        `점검 범위: ${reviewScope}. ${scopeInstruction}`,
        "첫 번째 파일은 교과서 원문입니다. 두 번째 파일이 있으면 YBM 내부 편집 통일 사항입니다.",
        `페이지 번호는 반드시 원문의 실제 페이지 인덱스 1~${totalPages} 사이로만 보고하세요.`,
        `NCIC 교육과정 원문: ${NCIC_URL}`,
        `한국과학창의재단 수학 교과용도서 검정 자료: ${KOSAC_URL}`,
      ].join("\n"),
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
          maxItems: 120,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["page", "type", "judgment", "title", "description", "before", "after", "standard", "referenceUrl", "format"],
            properties: {
              page: { type: "integer", minimum: 1, maximum: totalPages },
              type: { type: "string", enum: ["screening", "curriculum", "scope", "math", "style"] },
              judgment: { type: "string", enum: ["부적합 가능", "검토 필요", "수정 권고"] },
              title: { type: "string" },
              description: { type: "string" },
              before: { type: "string" },
              after: { type: "string" },
              standard: { type: "string" },
              referenceUrl: { type: "string" },
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
              text: `당신은 대한민국 교과용도서 개발 공정의 수학 교과서 검토 전문가이자 교정·교열 전문가입니다. 첨부 교과서의 모든 페이지와 문항을 빠짐없이 확인하고, 편집자가 공식 검정 신청 전에 수정해야 할 가능성이 높은 부분만 보고하세요.

<핵심 원칙>
- 이 결과는 공식 합격·불합격 판정이 아니라 '사전 점검'이다. 판단 표현은 부적합 가능, 검토 필요, 수정 권고 중 하나만 사용한다.
- 2022 개정 수학과 교육과정은 NCIC 공식 자료를 우선 검색해 확인한다. 수학과 교육과정은 교육부 고시 제2022-33호 별책 8이며, 선택된 학교급·과목의 성취기준을 임의로 바꾸지 않는다.
- 검정 절차와 기준 관련 내용은 한국과학창의재단 수학 교과용도서 공식 자료를 우선 사용한다.
- 공식 자료에서 확인하지 못한 기준 번호나 문구를 만들어 내지 않는다. 정확한 번호가 없으면 관련 기준의 영역과 확인한 취지만 적는다.
- OCR이 불명확하거나 근거가 약한 내용은 오류로 단정하지 않고 '검토 필요'로 보고한다.

<검정 교육과정 적합성 점검>
1. screening: 교육과정 준수 외에 교과서의 내용 정확성·공정성·중립성, 학습자 적합성, 교수·학습 및 평가의 타당성, 표현·표기의 적절성 등 검정 심사에서 편집자가 확인해야 할 부적합 가능성
2. curriculum: 선택된 과정의 성격·목표·내용 체계·성취기준과 맞지 않거나 필수 학습 요소를 왜곡·누락한 부분
3. scope: 선택된 학년·과목의 내용 수준, 학습량, 위계와 범위를 벗어난 개념 또는 풀이 방법

<교정·교열 및 수학 오류 점검>
4. math: 문제·예제·정답·해설·선택지·그래프·도형·조건·단위 사이의 수학적 모순, 계산 오류, 복수 정답, 해 부족·과잉, 논리 비약
5. style: 첨부한 내부 편집 기준 위반을 최우선으로 하고, 파일이 없으면 명백한 맞춤법·용어·문장·기호·표기 불일치만 보고

<보고 규칙>
- 실제 수정 또는 편집자 확인이 필요한 항목만 items에 넣는다. 오류가 없으면 빈 배열을 반환한다.
- 같은 원인을 유형만 바꿔 중복 보고하지 않는다. 가장 직접적인 한 유형으로 분류한다.
- before에는 원문의 해당 부분을 정확히 옮기고, after에는 바로 교체 가능한 수정안을 쓴다.
- 단순 삭제가 필요한 경우에도 after를 빈 문자열로 두지 말고 '[삭제]'라고 쓴다.
- standard에는 성취기준 코드나 심사 영역과 판단 근거를 간결하게 쓴다.
- referenceUrl에는 근거를 확인한 공식 NCIC 또는 한국과학창의재단의 HTTPS 주소를 쓴다.
- 문장 안 수식은 반드시 올바른 LaTeX로 $...$ 또는 $$...$$ 안에 넣는다. 전체가 수식이면 format=latex, 문장 속 일부만 수식이면 format=text다.
- summary에는 확인한 범위와 핵심 위험을 한국어로 간결하게 요약하고, 공식 최종 판정이 아님을 명시한다.`,
            }],
          },
          { role: "user", content: userContent },
        ],
        text: { format: { type: "json_schema", name: "textbook_review_report", strict: true, schema } },
        max_output_tokens: 20000,
      }),
    });

    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) {
      const apiError = payload.error && typeof payload.error === "object" ? payload.error as { message?: unknown } : null;
      const message = typeof apiError?.message === "string" ? apiError.message : "OpenAI API 점검 요청에 실패했습니다.";
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const outputText = extractOutputText(payload);
    if (!outputText) return NextResponse.json({ error: "AI가 점검 결과를 반환하지 않았습니다. 다시 시도해 주세요." }, { status: 502 });
    const report = JSON.parse(outputText) as { score?: unknown; summary?: unknown; items?: unknown };
    const items = Array.isArray(report.items)
      ? report.items
          .map((item, index) => ({ ...(item as Record<string, unknown>), id: index + 1 }) as Record<string, unknown> & { id: number })
          .filter((item) => Number(item.page) >= 1 && Number(item.page) <= totalPages)
      : [];
    return NextResponse.json({
      score: Math.max(0, Math.min(100, Number(report.score) || 0)),
      summary: String(report.summary ?? "AI 교과서 사전 점검이 완료되었습니다."),
      items,
    });
  } catch {
    return NextResponse.json({ error: "문서를 AI로 점검하는 중 문제가 발생했습니다. 파일 형식과 크기를 확인한 뒤 다시 시도해 주세요." }, { status: 500 });
  }
}
