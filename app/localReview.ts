export type ReviewType = "screening" | "curriculum" | "style" | "math" | "scope";

export type ReviewItem = {
  id: number;
  page: number;
  sourcePage?: string;
  type: ReviewType;
  title: string;
  description: string;
  before: string;
  after: string;
  standard?: string;
  judgment?: "부적합 가능" | "검토 필요" | "수정 권고";
  referenceUrl?: string;
  format?: "text" | "latex";
  verificationMethod?: "ai" | "deterministic";
  verificationEvidence?: string;
};

type ProgressHandler = (value: number) => void;
type ReviewResult = { score: number; summary: string; items: ReviewItem[] };

const stageTerms = [
  { term: "곱셈", stage: 2 }, { term: "나눗셈", stage: 3 }, { term: "분수", stage: 3 }, { term: "소수", stage: 3 },
  { term: "약수", stage: 5 }, { term: "배수", stage: 5 }, { term: "비례", stage: 6 }, { term: "방정식", stage: 7 },
  { term: "일차함수", stage: 8 }, { term: "피타고라스", stage: 8 }, { term: "인수분해", stage: 9 }, { term: "이차함수", stage: 9 },
  { term: "삼각비", stage: 9 }, { term: "행렬", stage: 10 }, { term: "로그", stage: 12 }, { term: "수열", stage: 12 },
  { term: "극한", stage: 13 }, { term: "미분", stage: 13 }, { term: "적분", stage: 13 }, { term: "확률분포", stage: 13 },
];

const courseExclusions: Record<string, string[]> = {
  "공통수학 1": ["극한", "미분", "적분", "로그", "수열", "삼각함수", "확률분포", "정규분포"],
  "공통수학 2": ["극한", "미분", "적분", "로그", "수열", "삼각함수", "확률분포", "정규분포"],
  "대수": ["극한", "미분", "적분", "확률분포", "정규분포", "표본평균"],
  "미적분Ⅰ": ["확률분포", "정규분포", "표본평균", "모평균"],
  "확률과 통계": ["도함수", "미분계수", "부정적분", "정적분", "함수의 극한"],
};

function normalizeText(value: string) {
  return value.replace(/\u0000/g, "").replace(/[\t\f\v ]+/g, " ").replace(/\r/g, "").trim();
}

function isGarbledPdfText(value: string) {
  const compact = value.replace(/\s/g, "");
  if (!compact) return false;
  const replacementCharacters = (compact.match(/[�ðþÃÂ¤]/g) ?? []).length;
  const extendedLatin = (compact.match(/[\u00c0-\u02af]/g) ?? []).filter((character) => !/[×÷]/.test(character)).length;
  return replacementCharacters >= 2 || extendedLatin / compact.length > 0.08;
}

function toLatexCode(expression: string) {
  const latex = expression
    .replace(/−/g, "-")
    .replace(/([0-9.]+)\s*[xX×*]\s*([0-9.]+)/g, "$1 \\times $2")
    .replace(/([0-9.]+)\s*[÷/]\s*([0-9.]+)/g, "\\frac{$1}{$2}")
    .replace(/≤/g, "\\le ")
    .replace(/≥/g, "\\ge ")
    .replace(/≠/g, "\\ne ")
    .replace(/√\s*([0-9a-zA-Z]+)/g, "\\sqrt{$1}")
    .replace(/π/g, "\\pi ")
    .replace(/²/g, "^{2}")
    .replace(/³/g, "^{3}")
    .replace(/\s+/g, " ")
    .trim();
  return `$${latex}$`;
}

async function createOcr(onProgress: ProgressHandler) {
  const { createWorker, OEM } = await import("tesseract.js");
  return createWorker(["kor", "eng"], OEM.LSTM_ONLY, {
    logger(message) {
      if (message.status === "recognizing text") onProgress(Math.max(12, Math.min(82, 12 + Math.round(message.progress * 55))));
    },
  });
}

async function extractPdf(file: File, onProgress: ProgressHandler, allowOcr: boolean) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  let worker: Awaited<ReturnType<typeof createOcr>> | null = null;

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = normalizeText(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));

      if (allowOcr && (text.replace(/\s/g, "").length < 25 || isGarbledPdfText(text))) {
        worker ??= await createOcr(onProgress);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2.2, Math.max(1.45, 1700 / Math.max(base.width, 1)));
        const viewport = page.getViewport({ scale });
        const canvas = window.document.createElement("canvas");
        const context = canvas.getContext("2d", { alpha: false });
        if (context) {
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const result = await worker.recognize(canvas);
          const ocrText = normalizeText(result.data.text);
          text = isGarbledPdfText(ocrText) ? "" : ocrText;
        }
      }

      pages.push(text);
      onProgress(12 + Math.round((pageNumber / document.numPages) * 58));
    }
  } finally {
    if (worker) await worker.terminate();
    await document.destroy();
  }
  return pages;
}

async function extractSource(file: File, onProgress: ProgressHandler) {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return extractPdf(file, onProgress, true);
  const worker = await createOcr(onProgress);
  try {
    const result = await worker.recognize(file);
    return [normalizeText(result.data.text)];
  } finally {
    await worker.terminate();
  }
}

async function extractGuide(file: File | null, onProgress: ProgressHandler) {
  if (!file) return "";
  if (file.type === "text/plain" || /\.txt$/i.test(file.name)) return normalizeText(await file.text());
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return (await extractPdf(file, onProgress, false)).join("\n");
  return "";
}

function selectedStage(grade: string) {
  const elementary = grade.match(/^초등 (\d)학년$/);
  if (elementary) return Number(elementary[1]);
  const middle = grade.match(/^중등 (\d)학년$/);
  if (middle) return 6 + Number(middle[1]);
  return grade === "공통수학 1" ? 10 : grade === "공통수학 2" ? 11 : 13;
}

function excerpt(text: string, index: number, length: number) {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + length + 24);
  return text.slice(start, end).replace(/\n+/g, " ").trim();
}

function guideReplacements(guide: string) {
  return guide.split("\n").map((line) => line.trim()).flatMap((line) => {
    const match = line.match(/^(.{1,50}?)\s*(?:→|->|=>)\s*(.{1,50})$/);
    return match ? [{ before: match[1].trim(), after: match[2].trim() }] : [];
  }).filter((rule) => rule.before && rule.after && rule.before !== rule.after).slice(0, 80);
}

function inspectPages(pages: string[], grade: string, guide: string) {
  const items: Omit<ReviewItem, "id">[] = [];
  const add = (item: Omit<ReviewItem, "id">) => {
    if (!items.some((existing) => existing.page === item.page && existing.type === item.type && existing.before === item.before)) items.push(item);
  };
  const stage = selectedStage(grade);
  const customRules = guideReplacements(guide);

  pages.forEach((text, pageIndex) => {
    const page = pageIndex + 1;
    const laterTerm = stageTerms.find((rule) => rule.stage > stage && text.includes(rule.term));
    const excludedTerm = courseExclusions[grade]?.find((term) => text.includes(term));
    const curriculumTerm = excludedTerm ?? laterTerm?.term;
    if (curriculumTerm) {
      const index = text.indexOf(curriculumTerm);
      add({ page, type: "curriculum", title: `${grade} 교육과정 범위 확인 필요`, description: `‘${curriculumTerm}’은 선택한 학년·과목의 핵심 범위보다 뒤에 다뤄질 가능성이 있습니다. NCIC 원문과 출제 의도를 함께 확인하세요.`, before: excerpt(text, index, curriculumTerm.length), after: `${grade} 성취기준에 맞는 개념으로 조정하거나 대상 학년·과목 설정을 변경`, standard: `2022 개정 수학과 교육과정 · ${grade}` });
    }

    const advancedSymbol = stage < 10 ? text.match(/∫|lim\b|Σ|[a-zA-Z]\s*['′]\s*\(/) : null;
    if (advancedSymbol?.index !== undefined) {
      add({ page, type: "scope", title: "선행 수학 기호 사용 가능성", description: "선택한 학년보다 뒤에서 주로 사용하는 수학 기호가 감지되었습니다.", before: excerpt(text, advancedSymbol.index, advancedSymbol[0].length), after: "선택 학년에서 사용하는 표현으로 바꾸거나 선수 학습 여부를 확인", standard: `2022 개정 교육과정 · ${grade} 내용 체계` });
    }

    const equation = /(-?\d+(?:\.\d+)?)\s*([+\-×xX*÷/])\s*(-?\d+(?:\.\d+)?)\s*=\s*(-?\d+(?:\.\d+)?)/g;
    for (const match of text.matchAll(equation)) {
      const left = Number(match[1]); const right = Number(match[3]); const shown = Number(match[4]);
      const operator = match[2];
      const expected = operator === "+" ? left + right : operator === "-" ? left - right : /[×xX*]/.test(operator) ? left * right : right === 0 ? Number.NaN : left / right;
      if (!Number.isFinite(expected) || Math.abs(expected - shown) > 1e-9) {
        const answer = Number.isFinite(expected) ? String(Number(expected.toFixed(8))) : "0으로 나눌 수 없음";
        add({ page, type: "math", title: "계산식 결과 확인 필요", description: "문서에서 읽은 사칙연산 식의 좌변과 우변이 일치하지 않습니다. OCR 인식 결과도 함께 확인하세요. 수식은 LaTeX 코드로 표시했습니다.", before: toLatexCode(match[0]), after: Number.isFinite(expected) ? toLatexCode(`${match[1]} ${operator} ${match[3]} = ${answer}`) : `$\\text{${match[1]} ${operator} ${match[3]}은 정의되지 않음}$`, format: "latex" });
      }
    }

    const styleRules = [
      { regex: /되어진/, after: "된", title: "불필요한 이중 피동 표현" },
      { regex: /([가-힣])\s+([,.])/, after: "$1$2", title: "문장부호 앞 공백 정리" },
      { regex: /([!?])\1+/, after: "$1", title: "문장부호 중복 사용" },
    ];
    for (const rule of styleRules) {
      const match = text.match(rule.regex);
      if (match?.index !== undefined) add({ page, type: "style", title: rule.title, description: "기본 편집 통일 규칙에 따라 표기를 정리하는 것이 좋습니다.", before: excerpt(text, match.index, match[0].length), after: excerpt(text.replace(rule.regex, rule.after), match.index, rule.after.length), standard: "기본 편집 통일 규칙" });
    }

    for (const rule of customRules) {
      const index = text.indexOf(rule.before);
      if (index >= 0) add({ page, type: "style", title: "첨부 편집 기준과 다른 표기", description: "첨부한 편집 기준에서 BEFORE → AFTER 형식으로 읽은 규칙을 적용했습니다.", before: excerpt(text, index, rule.before.length), after: excerpt(text.replace(rule.before, rule.after), index, rule.after.length), standard: "첨부한 내부 편집 통일 사항" });
    }
  });
  return items.slice(0, 80).map((item, index) => ({ ...item, id: index + 1 }));
}

export async function runLocalReview(source: File, guide: File | null, grade: string, onProgress: ProgressHandler): Promise<ReviewResult> {
  onProgress(6);
  const pages = await extractSource(source, onProgress);
  if (!pages.some((text) => text.replace(/\s/g, "").length >= 5)) throw new Error("문서에서 글자를 인식하지 못했습니다. 해상도가 더 높은 PDF 또는 이미지를 사용해 주세요.");
  onProgress(72);
  const guideText = await extractGuide(guide, (value) => onProgress(Math.max(72, Math.min(84, value))));
  onProgress(86);
  const items = inspectPages(pages, grade, guideText);
  const penalty = items.reduce((sum, item) => sum + (item.type === "math" ? 12 : item.type === "style" ? 4 : 8), 0);
  const recognized = pages.filter((text) => text.replace(/\s/g, "").length >= 5).length;
  const guideNote = guide ? (guideText ? " 첨부 편집 기준도 함께 적용했습니다." : " 첨부 편집 기준은 TXT 또는 텍스트형 PDF만 읽을 수 있어 기본 규칙만 적용했습니다.") : "";
  const summary = items.length
    ? `${pages.length}페이지 중 ${recognized}페이지의 텍스트를 인식해 자동 규칙 검수를 완료했습니다.${guideNote} 결과는 최종 교정 전 원문과 대조해 주세요.`
    : `${pages.length}페이지 중 ${recognized}페이지의 텍스트를 인식했으며 현재 자동 규칙에서 검토 항목을 찾지 못했습니다.${guideNote}`;
  onProgress(100);
  return { score: Math.max(0, 100 - penalty), summary, items };
}
