"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import type { Cell, SheetData } from "write-excel-file/universal";
import PdfSplitter from "./PdfSplitter";
import { type ReviewItem, type ReviewType } from "./localReview";

const NCIC_URL = "https://ncic.re.kr/inv/org/list.do";
const KOSAC_URL = "https://www.kosac.re.kr/menus/270/boards/386/posts/38218";
const MAX_SOURCE_MB = 50;
const MAX_SOURCE_BYTES = MAX_SOURCE_MB * 1_000_000;
const MAX_SOURCE_PAGES = 100;

const subjects = ["수학", "영어", "체육", "음악", "보건", "한문", "정보"] as const;

const gradeGroups = [
  { label: "초등", grades: ["1학년", "2학년", "3학년", "4학년", "5학년", "6학년"] },
  { label: "중등", grades: ["1학년", "2학년", "3학년"] },
  {
    label: "고등",
    grades: [
      "공통수학 1",
      "공통수학 2",
      "대수",
      "미적분Ⅰ",
      "확률과 통계",
      "미적분Ⅱ",
      "기하",
      "경제 수학",
    ],
  },
];

const UNIFIED_REVIEW_LABEL = "AI 모의 심사";

async function readApiPayload<T>(response: Response): Promise<T> {
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    const status = response.status ? ` (오류 코드 ${response.status})` : "";
    throw new Error(`분석 서버의 응답을 확인할 수 없습니다${status}. 잠시 후 다시 시도해 주세요.`);
  }
}
const UNIFIED_REVIEW_DESCRIPTION = "교정·교열, 수학적 정확성, 2022 개정 교육과정, 학년 범위와 검정 심사 기준을 한 번에 확인합니다.";
const reviewTypes: ReviewType[] = ["math", "style", "screening", "curriculum", "scope"];

type AuditSummary = {
  totalPages: number;
  fullyReviewedPages: number;
  unreadablePages: number[];
  deterministicChecks: number;
  protectedItems: number;
  stages: Array<{ name: string; reviewedPages: number; unreadablePages: number[] }>;
};

const typeMeta: Record<ReviewType, { label: string; short: string; color: string; group: string }> = {
  screening: { label: "검정 심사 적합성", short: "검정", color: "navy", group: "교육과정 적합성" },
  curriculum: { label: "2022 수학과 교육과정", short: "교육과정", color: "blue", group: "교육과정 적합성" },
  scope: { label: "학년·과목 범위", short: "범위", color: "amber", group: "교육과정 적합성" },
  math: { label: "수학적 오류", short: "수학", color: "red", group: "교정·교열" },
  style: { label: "교정·교열 및 편집 기준", short: "교정", color: "violet", group: "교정·교열" },
};

function Icon({ name }: { name: string }) {
  const icons: Record<string, string> = {
    upload: "↑", file: "▤", check: "✓", download: "↓", search: "⌕", arrow: "→", shield: "◆",
  };
  return <span aria-hidden="true">{icons[name] ?? "•"}</span>;
}

function YbmLogo() {
  return (
    <span className="ybm-logo" aria-label="YBM">
      <img src="/ybm-logo.png" width="148" height="66" alt="YBM" />
    </span>
  );
}

function renderKatex(source: string, displayMode: boolean) {
  try {
    return katex.renderToString(source, {
      displayMode, throwOnError: displayMode ? false : true, strict: false, trust: false, output: "htmlAndMathml",
    });
  } catch {
    return null;
  }
}

function MathFormula({ value }: { value: string }) {
  const source = value.trim()
    .replace(/^```(?:latex|tex)?\s*/i, "").replace(/\s*```$/, "")
    .replace(/^\$\$([\s\S]*)\$\$$/, "$1").replace(/^\\\[([\s\S]*)\\\]$/, "$1")
    .replace(/^\\\(([\s\S]*)\\\)$/, "$1").replace(/^\$([\s\S]*)\$$/, "$1").trim();
  const html = renderKatex(source, true);
  return html
    ? <div className="math-render" aria-label={value} dangerouslySetInnerHTML={{ __html: html }} />
    : <p className="math-fallback">{value}</p>;
}

const mathTokenPattern = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$)/g;

function parseMathToken(token: string) {
  if (token.startsWith("$$") && token.endsWith("$$")) return { source: token.slice(2, -2), displayMode: true };
  if (token.startsWith("\\[") && token.endsWith("\\]")) return { source: token.slice(2, -2), displayMode: true };
  if (token.startsWith("\\(") && token.endsWith("\\)")) return { source: token.slice(2, -2), displayMode: false };
  if (token.startsWith("$") && token.endsWith("$")) return { source: token.slice(1, -1), displayMode: false };
  return null;
}

function RichMathText({ value, forceMath = false, className }: { value: string; forceMath?: boolean; className?: string }) {
  const parts = value.split(mathTokenPattern);
  const hasDelimitedMath = parts.some((part) => parseMathToken(part));
  if (!hasDelimitedMath && forceMath) return <MathFormula value={value} />;
  return <p className={className}>{parts.map((part, index) => {
    const math = parseMathToken(part);
    if (!math) return part;
    const html = renderKatex(math.source.trim(), math.displayMode);
    return html
      ? <span className={math.displayMode ? "math-block" : "inline-math"} key={`${index}-${part}`} dangerouslySetInnerHTML={{ __html: html }} />
      : <span className="math-source-fallback" key={`${index}-${part}`}>{part}</span>;
  })}</p>;
}

function hasDraggedFiles(transfer: DataTransfer) {
  const types = Array.from(transfer.types ?? []);
  return transfer.files.length > 0 || types.includes("Files");
}

function safeReferenceUrl(value?: string) {
  if (!value) return NCIC_URL;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : NCIC_URL;
  } catch {
    return NCIC_URL;
  }
}

function visibleSourcePage(value?: string) {
  const label = value?.trim() ?? "";
  return /^(없음|확인\s*불가|미확인|-|n\/a)$/i.test(label) ? "" : label;
}

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const guideInput = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragDepthRef = useRef(0);
  const [tool, setTool] = useState<"review" | "split">("review");
  const [subject, setSubject] = useState<(typeof subjects)[number]>("수학");
  const [grade, setGrade] = useState("초등 6학년");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [guideFile, setGuideFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [sourcePages, setSourcePages] = useState(0);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<"setup" | "analyzing" | "result">("setup");
  const [activeType, setActiveType] = useState<ReviewType | "all">("all");
  const [activePage, setActivePage] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [score, setScore] = useState(100);
  const [analysisSummary, setAnalysisSummary] = useState("");
  const [auditSummary, setAuditSummary] = useState<AuditSummary | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [exportingReport, setExportingReport] = useState(false);
  const [reportError, setReportError] = useState("");
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const checkConfiguration = async (attempt = 0) => {
      try {
        const response = await fetch(`/api/review?check=${Date.now()}`, { cache: "no-store" });
        if (!response.ok) throw new Error("API 상태 확인 실패");
        const payload = await readApiPayload<{ configured?: boolean }>(response);
        if (!cancelled) setAiConfigured(Boolean(payload.configured));
      } catch {
        if (cancelled) return;
        if (attempt < 2) retryTimer = setTimeout(() => void checkConfiguration(attempt + 1), 900);
        else setAiConfigured(false);
      }
    };
    void checkConfiguration();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    const preventBrowserFileOpen = (event: globalThis.DragEvent) => {
      if (event.dataTransfer && hasDraggedFiles(event.dataTransfer)) event.preventDefault();
    };
    window.addEventListener("dragover", preventBrowserFileOpen);
    window.addEventListener("drop", preventBrowserFileOpen);
    return () => {
      window.removeEventListener("dragover", preventBrowserFileOpen);
      window.removeEventListener("drop", preventBrowserFileOpen);
    };
  }, []);

  const visibleItems = useMemo(
    () => reviewItems.filter((item) => item.page === activePage && (activeType === "all" || item.type === activeType)),
    [activePage, activeType, reviewItems],
  );
  const issuePages = useMemo(() => [...new Set(reviewItems.map((item) => item.page))].sort((a, b) => a - b), [reviewItems]);

  async function selectSource(file?: File) {
    if (!file) return;
    const valid = file.type === "application/pdf" || file.type.startsWith("image/") || /\.(pdf|png|jpe?g|webp)$/i.test(file.name);
    if (!valid) { setAnalysisError("PDF, PNG, JPG, WEBP 파일만 선택할 수 있습니다."); return; }
    if (file.size > MAX_SOURCE_BYTES) {
      setAnalysisError(`검수 파일은 최대 ${MAX_SOURCE_MB}MB까지 업로드할 수 있습니다.`);
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const nextPreviewUrl = URL.createObjectURL(file);
    setSourceFile(file);
    setPreviewUrl(nextPreviewUrl);
    setSourcePages(file.type.startsWith("image/") ? 1 : 0);
    setStage("setup"); setProgress(0); setReviewItems([]); setAnalysisError(""); setAnalysisSummary(""); setAuditSummary(null);
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
        if (document.numPages > MAX_SOURCE_PAGES) {
          await document.destroy();
          URL.revokeObjectURL(nextPreviewUrl);
          setSourceFile(null); setSourcePages(0); setPreviewUrl("");
          setAnalysisError(`한 번에 최대 ${MAX_SOURCE_PAGES}페이지까지 검수할 수 있습니다. PDF를 나눈 뒤 다시 첨부해 주세요.`);
          return;
        }
        setSourcePages(document.numPages);
        await document.destroy();
      } catch {
        setSourceFile(null); setSourcePages(0); setPreviewUrl("");
        setAnalysisError("PDF 페이지를 읽지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요.");
      }
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) { void selectSource(event.target.files?.[0]); }
  function onDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault(); event.stopPropagation();
    if (!hasDraggedFiles(event.dataTransfer)) return;
    dragDepthRef.current += 1; setDragging(true);
  }
  function onDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault(); event.stopPropagation();
    if (hasDraggedFiles(event.dataTransfer)) event.dataTransfer.dropEffect = "copy";
  }
  function onDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault(); event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragging(false);
  }
  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault(); event.stopPropagation();
    dragDepthRef.current = 0; setDragging(false);
    const itemFile = Array.from(event.dataTransfer.items ?? []).find((item) => item.kind === "file")?.getAsFile();
    void selectSource(itemFile ?? event.dataTransfer.files?.[0]);
  }

  async function startAnalysis() {
    if (!sourceFile || !sourcePages) return;
    if (!aiConfigured) {
      setAnalysisError("OpenAI API 키가 배포 환경에 연결되지 않았습니다. 서버 환경변수를 확인한 뒤 다시 배포해 주세요.");
      return;
    }
    setStage("analyzing"); setProgress(3); setAnalysisError("");
    try {
      timerRef.current = setInterval(() => setProgress((current) => Math.min(90, current + (current < 55 ? 2 : 1))), 700);
      const form = new FormData();
      form.append("file", sourceFile);
      form.append("subject", subject);
      form.append("grade", grade);
      form.append("totalPages", String(sourcePages));
      if (guideFile) form.append("guide", guideFile);
      const response = await fetch("/api/review", { method: "POST", body: form });
      const payload = await readApiPayload<{ error?: string; score?: number; summary?: string; items?: ReviewItem[]; audit?: AuditSummary }>(response);
      if (!response.ok) throw new Error(payload.error || "AI 모의 심사 요청에 실패했습니다.");
      const result = {
        score: Math.max(0, Math.min(100, Number(payload.score) || 0)),
        summary: payload.summary || "AI 모의 심사가 완료되었습니다.",
        items: Array.isArray(payload.items) ? payload.items : [],
      };
      setProgress(100);
      const items = result.items.filter((item) => item.page >= 1 && item.page <= sourcePages);
      setReviewItems(items); setScore(result.score); setAnalysisSummary(result.summary);
      setAuditSummary(payload.audit ?? null);
      setActivePage(items[0]?.page ?? 1); setActiveType("all");
      window.setTimeout(() => setStage("result"), 250);
    } catch (reason) {
      setAnalysisError(reason instanceof Error ? reason.message : "문서를 분석하는 중 문제가 발생했습니다.");
      setStage("setup"); setProgress(0);
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }

  function reset() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(null); setPreviewUrl(""); setSourcePages(0); setProgress(0); setStage("setup");
    setReviewItems([]); setAnalysisError(""); setAnalysisSummary(""); setAuditSummary(null); setScore(100);
    setReportError(""); setExportingReport(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function saveReport() {
    if (exportingReport) return;
    setExportingReport(true);
    setReportError("");

    const navy = "#0757A5";
    const red = "#ED2939";
    const paleBlue = "#EAF3FC";
    const paleRed = "#FFF0F1";
    const line = "#D8E1EC";
    const headerCell = (value: string): Cell => ({
      value, fontWeight: "bold", textColor: "#FFFFFF", backgroundColor: navy,
      align: "center", alignVertical: "center", wrap: true, height: 30,
      borderColor: "#FFFFFF", borderStyle: "thin",
    });
    const labelCell = (value: string): Cell => ({
      value, fontWeight: "bold", textColor: navy, backgroundColor: paleBlue,
      alignVertical: "center", borderColor: line, borderStyle: "thin",
    });
    const valueCell = (value: string | number): Cell => ({
      value, alignVertical: "center", wrap: true, borderColor: line, borderStyle: "thin",
    });
    const today = new Date();

    const summaryData: SheetData = [
      [{ value: "YBM 교과서 AI 모의 심사 결과 보고서", columnSpan: 6, fontSize: 18, fontWeight: "bold", textColor: "#FFFFFF", backgroundColor: navy, align: "center", alignVertical: "center", height: 38 }, null, null, null, null, null],
      [null, null, null, null, null, null],
      [labelCell("과목"), valueCell(subject), labelCell("대상 학년"), valueCell(grade), labelCell("검수일"), { value: today, type: Date, format: "yyyy-mm-dd", borderColor: line, borderStyle: "thin" }],
      [labelCell("검수 범위"), { ...valueCell(UNIFIED_REVIEW_LABEL), columnSpan: 3 }, null, null, labelCell("총 페이지"), valueCell(sourcePages)],
      [labelCell("원본 파일"), { ...valueCell(sourceFile?.name ?? "-"), columnSpan: 3 }, null, null, labelCell("종합 적합도"), { ...valueCell(score), type: Number, format: '0"점"', fontWeight: "bold", textColor: score >= 80 ? navy : red }],
      [null, null, null, null, null, null],
      [{ value: "검수 결과 요약", columnSpan: 6, fontWeight: "bold", textColor: "#FFFFFF", backgroundColor: red, height: 26 }, null, null, null, null, null],
      [labelCell("검토 페이지"), valueCell(issuePages.length), labelCell("검토 항목"), valueCell(reviewItems.length), labelCell("전체 페이지"), valueCell(sourcePages)],
      ...reviewTypes.map((type) => [
        labelCell(typeMeta[type].label),
        { ...valueCell(reviewItems.filter((item) => item.type === type).length), type: Number },
        { value: typeMeta[type].group, columnSpan: 4, textColor: "#55657A", wrap: true, borderColor: line, borderStyle: "thin" },
        null, null, null,
      ] as Cell[]),
      ...(auditSummary ? [
        [null, null, null, null, null, null],
        [{ value: "검수 추적 기록", columnSpan: 6, fontWeight: "bold", textColor: navy, backgroundColor: paleBlue, height: 26 }, null, null, null, null, null],
        [labelCell("교차 확인 페이지"), valueCell(`${auditSummary.fullyReviewedPages}/${auditSummary.totalPages}`), labelCell("계산 엔진 검증"), valueCell(auditSummary.deterministicChecks), labelCell("확정 보호 항목"), valueCell(auditSummary.protectedItems)],
        [labelCell("판독 확인 페이지"), { ...valueCell(auditSummary.unreadablePages.join(", ") || "없음"), columnSpan: 5 }, null, null, null, null],
        ...auditSummary.stages.map((item) => [labelCell(item.name), { ...valueCell(`${item.reviewedPages}/${auditSummary.totalPages}페이지`), columnSpan: 5 }, null, null, null, null] as Cell[]),
      ] as SheetData : []),
      [null, null, null, null, null, null],
      [{ value: "AI 분석 요약", columnSpan: 6, fontWeight: "bold", textColor: navy, backgroundColor: paleBlue, height: 26 }, null, null, null, null, null],
      [{ value: analysisSummary || "별도 요약이 없습니다.", columnSpan: 6, wrap: true, alignVertical: "top", height: 70, borderColor: line, borderStyle: "thin" }, null, null, null, null, null],
      [null, null, null, null, null, null],
      [{ value: "안내: 본 결과는 편집자의 최종 판단을 지원하는 AI 사전 검수 자료이며, 공식 심사 결과를 의미하지 않습니다.", columnSpan: 6, fontStyle: "italic", textColor: "#67768B", backgroundColor: "#F5F7FA", wrap: true, height: 34 }, null, null, null, null, null],
    ];

    const detailData: SheetData = [
      ["PDF 페이지", "지면 표기", "영역", "세부 항목", "판단", "제목", "설명", "검증 방식", "검증 근거", "참조 기준", "BEFORE", "AFTER", "출처"].map((value) => headerCell(value)),
      ...reviewItems.map((item) => [
        { value: item.page, type: Number, align: "center", borderColor: line, borderStyle: "thin" },
        { ...valueCell(visibleSourcePage(item.sourcePage)), align: "center" },
        valueCell(typeMeta[item.type].group),
        valueCell(typeMeta[item.type].label),
        { ...valueCell(item.judgment ?? "검토 필요"), fontWeight: "bold", textColor: red, align: "center" },
        valueCell(item.title),
        valueCell(item.description),
        valueCell(item.verificationMethod === "deterministic" ? "계산 엔진" : "AI 교차 검증"),
        valueCell(item.verificationEvidence ?? ""),
        valueCell(item.standard ?? ""),
        { ...valueCell(item.before), backgroundColor: paleRed, textColor: "#A51D2D" },
        { ...valueCell(item.after), backgroundColor: paleBlue, textColor: navy },
        valueCell(item.referenceUrl ?? ""),
      ] as Cell[]),
    ];

    try {
      const { default: writeExcelFile } = await import("write-excel-file/universal");
      const blob = await writeExcelFile([
        {
          data: summaryData, sheet: "검수 요약", showGridLines: false, zoomScale: 90,
          columns: [{ width: 18 }, { width: 28 }, { width: 18 }, { width: 28 }, { width: 18 }, { width: 28 }],
        },
        {
          data: detailData, sheet: "상세 결과", showGridLines: false, stickyRowsCount: 1,
          zoomScale: 85, orientation: "landscape",
          columns: [{ width: 11 }, { width: 11 }, { width: 18 }, { width: 22 }, { width: 13 }, { width: 28 }, { width: 48 }, { width: 16 }, { width: 34 }, { width: 32 }, { width: 38 }, { width: 38 }, { width: 36 }],
        },
      ]).toBlob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const fileDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
      anchor.href = url;
      anchor.download = `YBM_${subject}_${grade.replace(/\s+/g, "_")}_AI모의심사_${fileDate}.xlsx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setReportError("엑셀 보고서를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setExportingReport(false);
    }
  }

  return (
    <main>
      <header className="topbar">
        <button className="brand brand-button ybm-brand" onClick={() => setTool("review")}>
          <YbmLogo /><span className="brand-divider" /><span>교과서 AI 모의 심사</span>
          <i>{aiConfigured === null ? "확인 중" : aiConfigured ? "AI 연결" : "API 필요"}</i>
        </button>
        <nav className="tool-nav">
          <button className={tool === "review" ? "active" : ""} onClick={() => setTool("review")}>AI 모의 심사</button>
          <button className={tool === "split" ? "active" : ""} onClick={() => setTool("split")}>PDF 나누기</button>
          <a href={NCIC_URL} target="_blank" rel="noreferrer">NCIC 교육과정 ↗</a>
        </nav>
      </header>

      {tool === "split" ? <PdfSplitter /> : stage !== "result" ? (
        <>
          <section className="hero textbook-hero" id="top">
            <div className="hero-kicker">YBM TEXTBOOK QUALITY WORKSPACE</div>
            <div className="hero-badge"><Icon name="shield" /> 2022 개정 교육과정 기반 사전 점검</div>
            <h1>교과서 AI 모의 심사</h1>
            <p>파일을 한 번만 첨부하면 교정·교열부터 교육과정 적합성까지 통합 검토합니다.</p>
            <div className="proof-row">
              <span><Icon name="check" /> NCIC 공식 교육과정 참조</span>
              <span><Icon name="check" /> 수학 문항·풀이 정밀 검증</span>
              <span><Icon name="check" /> 검정 심사 전 사전 점검</span>
            </div>
          </section>

          <section className="flow-strip" aria-label="점검 절차">
            <div className="flow-step active"><b>01</b><span><strong>과목·범위 설정</strong><small>수학 및 점검 영역 선택</small></span></div>
            <i>→</i><div className={`flow-step ${sourceFile ? "active" : ""}`}><b>02</b><span><strong>교과서 업로드</strong><small>PDF 또는 이미지 첨부</small></span></div>
            <i>→</i><div className={`flow-step ${stage === "analyzing" ? "active" : ""}`}><b>03</b><span><strong>AI 정밀 분석</strong><small>수학 2회·교육과정 2회·계산 검증</small></span></div>
            <i>→</i><div className="flow-step"><b>04</b><span><strong>편집자 검토</strong><small>수정안 확인 및 저장</small></span></div>
          </section>

          <section className="subject-section" aria-labelledby="subject-title">
            <div className="section-heading">
              <div><span>STEP 01</span><h2 id="subject-title">개발 중인 과목을 선택해 주세요</h2></div>
              <p>현재 수학 교과서 점검 기능부터 제공합니다.</p>
            </div>
            <div className="subject-grid">
              {subjects.map((item) => {
                const available = item === "수학";
                return <button key={item} type="button" disabled={!available} className={subject === item ? "active" : ""} onClick={() => available && setSubject(item)}>
                  <strong>{item}</strong><small>{available ? "사용 가능" : "준비 중"}</small>
                </button>;
              })}
            </div>
          </section>

          <section className="review-workspace" aria-label="AI 모의 심사 설정">
            <section className="setup-shell review-workarea" id="workflow">
            {stage === "analyzing" ? (
              <div className="analyzing-card">
                <div className="orbit" style={{ background: `conic-gradient(#0757a5 ${progress}%, #e8edf5 0)` }}><span>{progress}%</span></div>
                <p className="section-label">AI 모의 심사 진행 중</p>
                <h2>{subject} 교과서를 심사 기준에 맞춰 살펴보고 있어요</h2>
                <p>{progress < 20 ? "문서에서 본문, 수식과 편집 요소를 읽는 중입니다." : progress < 40 ? "수학 오류를 1차 분석하고 독립적으로 다시 검산하고 있습니다." : progress < 62 ? `${grade} 내용을 2022 개정 교육과정과 두 번 대조하고 있습니다.` : progress < 80 ? "추출된 수치 등식을 정확한 유리수 연산으로 검증하고 있습니다." : "확정 오류 보호, 후보별 최종 판정과 중복 제거를 진행하고 있습니다."}</p>
                <div className="analysis-track"><span style={{ width: `${progress}%` }} /></div>
                <div className="analysis-checks">
                  {reviewTypes.map((type, index) => <span className={progress > (index + 1) * (70 / reviewTypes.length) ? "done" : ""} key={type}><Icon name="check" /> {typeMeta[type].label}</span>)}
                </div>
              </div>
            ) : (
              <div className="setup-grid textbook-setup">
                <section className="setup-card">
                  <div className="card-title"><b>2</b><div><h2>통합 심사 기준을 설정해 주세요</h2><p>{UNIFIED_REVIEW_DESCRIPTION}</p></div></div>
                  <label className="field-label" htmlFor="grade">대상 학년·과목 <span>필수</span></label>
                  <select id="grade" value={grade} onChange={(event) => setGrade(event.target.value)}>
                    {gradeGroups.map((group) => <optgroup label={group.label} key={group.label}>{group.grades.map((item) => <option key={`${group.label}-${item}`}>{group.label === "초등" ? `초등 ${item}` : group.label === "중등" ? `중등 ${item}` : item}</option>)}</optgroup>)}
                  </select>
                  <div className="official-sources">
                    <a href={NCIC_URL} target="_blank" rel="noreferrer"><span className="status-icon"><Icon name="check" /></span><div><strong>2022 개정 수학과 교육과정</strong><small>NCIC 원문 인벤토리 · 별책 8 및 {grade} 성취기준</small></div><em>원문 ↗</em></a>
                    <a href={KOSAC_URL} target="_blank" rel="noreferrer"><span className="status-icon"><Icon name="check" /></span><div><strong>수학 교과용도서 검정 자료</strong><small>한국과학창의재단 검정 신청·심사 공식 자료</small></div><em>자료 ↗</em></a>
                  </div>
                  <label className="field-label">내부 편집 통일 사항 <span className="optional">선택</span></label>
                  <input ref={guideInput} type="file" accept=".pdf,.doc,.docx,.txt,text/plain,application/pdf" hidden onChange={(event) => setGuideFile(event.target.files?.[0] ?? null)} />
                  <button className="guide-upload" type="button" onClick={() => guideInput.current?.click()}>
                    <Icon name="file" /><span><strong>{guideFile?.name ?? "편집 기준 파일을 첨부해 주세요"}</strong><small>PDF, DOCX, TXT · 최대 10MB</small></span><em>{guideFile ? "변경" : "파일 선택"}</em>
                  </button>
                </section>

                <section className={`setup-card upload-card ${dragging ? "dragging" : ""}`} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
                  <div className="card-title"><b>3</b><div><h2>심사할 교과서를 올려 주세요</h2><p>한 번의 첨부로 모든 심사 영역을 함께 분석합니다.</p></div></div>
                  <input ref={fileInput} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={onFileChange} />
                  {dragging && <div className="drop-capture" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}><div><span><Icon name="upload" /></span><strong>파일을 놓아 업로드하세요</strong><small>PDF, PNG, JPG, WEBP</small></div></div>}
                  {!sourceFile ? (
                    <div className={`dropzone ${dragging ? "dragging" : ""}`} role="button" tabIndex={0} onClick={() => fileInput.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInput.current?.click(); }}>
                      <span className="upload-circle"><Icon name="upload" /></span><strong>파일을 이 영역에 끌어다 놓으세요</strong><p>또는</p>
                      <button type="button" onClick={(event) => { event.stopPropagation(); fileInput.current?.click(); }}>내 컴퓨터에서 선택</button><small>PDF, PNG, JPG, WEBP · 최대 50MB · PDF 최대 100페이지</small>
                    </div>
                  ) : (
                    <div className="selected-file"><span className="file-preview">{sourceFile.type.startsWith("image/") ? <img src={previewUrl} alt="업로드 미리보기" /> : <Icon name="file" />}</span><div><strong>{sourceFile.name}</strong><small>{(sourceFile.size / 1024 / 1024).toFixed(2)}MB · {sourcePages ? `${sourcePages}페이지 · 분석 준비 완료` : "페이지 확인 중"}</small></div><button onClick={reset} aria-label="파일 삭제">×</button></div>
                  )}
                  <button className="analyze-button" type="button" disabled={!sourceFile || !sourcePages || aiConfigured !== true} onClick={startAnalysis}><Icon name="search" /> {aiConfigured === null ? "API 연결 확인 중" : aiConfigured ? "AI 모의 심사 시작하기" : "API 키 연결 필요"} <Icon name="arrow" /></button>
                  {analysisError && <p className="error-banner" role="alert">{analysisError}</p>}
                  <p className="privacy-copy"><Icon name="shield" /> {aiConfigured ? "파일은 분석을 위해 OpenAI API로 암호화 전송되며 응답 저장은 비활성화됩니다." : "배포 환경의 OPENAI_API_KEY 연결 상태를 확인해 주세요."}</p>
                </section>
              </div>
            )}
            </section>
          </section>
          <section className="notice-strip"><strong>안내</strong><p>이 기능은 편집자의 심사 전 검토를 돕는 AI 사전 점검 도구입니다. 공식 검정기관의 최종 심사 결과를 대신하거나 합격을 보장하지 않습니다.</p></section>
        </>
      ) : (
        <section className="result-page" id="top">
          <div className="result-top"><div><button className="back-button" onClick={reset}>← 새 심사</button><p className="section-label">AI 모의 심사 완료</p><h1>{subject} 교과서 심사 결과</h1><span>{sourceFile?.name} · {grade} · 총 {sourcePages}페이지 · {UNIFIED_REVIEW_LABEL}</span></div><div className="report-actions"><button className="save-report" onClick={saveReport} disabled={exportingReport}><Icon name="download" /> {exportingReport ? "엑셀 생성 중…" : "엑셀 보고서 다운로드"}</button>{reportError && <span role="alert">{reportError}</span>}</div></div>
          <div className="result-disclaimer">AI가 발견한 ‘부적합 가능성’과 수정 권고입니다. 편집자가 공식 원문과 대조하여 최종 판단해 주세요.</div>
          <div className="summary-grid textbook-summary unified">
            <article className="score-card"><span>종합 적합도</span><strong>{score}<small>점</small></strong><p><i style={{ width: `${score}%` }} /></p><em>검토가 필요한 항목이 {reviewItems.length}개 있습니다.</em></article>
            {reviewTypes.map((type) => {
              const count = reviewItems.filter((item) => item.type === type).length;
              return <button className={`metric-card ${typeMeta[type].color} ${activeType === type ? "selected" : ""}`} key={type} onClick={() => setActiveType(activeType === type ? "all" : type)}><span>{typeMeta[type].label}</span><strong>{count}<small>건</small></strong><em>{count === 0 ? "발견 없음" : count > 1 ? "검토 필요" : "확인 권장"}</em></button>;
            })}
          </div>
          {analysisSummary && <RichMathText value={analysisSummary} className="result-summary" />}
          {auditSummary && <section className="audit-panel" aria-label="전수 검수 기록">
            <div className="audit-heading"><div><span>검수 추적 기록</span><strong>{auditSummary.fullyReviewedPages === auditSummary.totalPages ? "전체 페이지 교차 확인 완료" : "일부 페이지 추가 확인 필요"}</strong></div><em>{auditSummary.fullyReviewedPages}/{auditSummary.totalPages}페이지</em></div>
            <div className="audit-grid">
              {auditSummary.stages.map((item) => <div key={item.name}><span>{item.name}</span><strong>{item.reviewedPages}<small>/{auditSummary.totalPages}p</small></strong></div>)}
              <div><span>계산 엔진 검증</span><strong>{auditSummary.deterministicChecks}<small>개 등식</small></strong></div>
              <div><span>삭제 방지 확정 항목</span><strong>{auditSummary.protectedItems}<small>건</small></strong></div>
            </div>
            {auditSummary.unreadablePages.length > 0 && <p>판독 확인이 필요한 PDF 페이지: {auditSummary.unreadablePages.join(", ")}</p>}
          </section>}

          <div className="review-layout">
            <aside className="page-sidebar"><div><strong>검토 페이지</strong><span>{issuePages.length}개</span></div>{issuePages.length ? issuePages.map((page) => <button key={page} className={activePage === page ? "active" : ""} onClick={() => setActivePage(page)}><span className={`page-thumb p${page}`}><i>{page}</i></span><em><strong>{page}페이지</strong><small>{reviewItems.filter((item) => item.page === page).length}개 항목</small></em></button>) : <p className="no-issue-pages">검토가 필요한 페이지가 없습니다.</p>}</aside>
            <section className="review-main">
              <div className="review-heading"><div><span className="section-label">PAGE {activePage}</span><h2>{activePage}페이지 점검 결과</h2></div><div className="filter-row"><button className={activeType === "all" ? "active" : ""} onClick={() => setActiveType("all")}>전체</button>{reviewTypes.map((type) => <button className={activeType === type ? "active" : ""} key={type} onClick={() => setActiveType(type)}>{typeMeta[type].short}</button>)}</div></div>
              {visibleItems.length ? visibleItems.map((item) => <article className="issue-card" key={item.id}>
                <div className="issue-title"><span className="source-page-badge">PDF {item.page}페이지{visibleSourcePage(item.sourcePage) ? ` · 지면 ${visibleSourcePage(item.sourcePage)}쪽` : ""}</span><span className={`tag ${typeMeta[item.type].color}`}>{typeMeta[item.type].label}</span><h3>{item.title}</h3><b>{item.judgment ?? "검토 필요"}</b></div>
                <RichMathText value={item.description} />
                {item.verificationEvidence && <p className={`verification-evidence ${item.verificationMethod === "deterministic" ? "deterministic" : ""}`}><Icon name="check" /> {item.verificationMethod === "deterministic" ? "계산 엔진 확정" : "검증 근거"} · {item.verificationEvidence}</p>}
                {item.standard && (item.referenceUrl ? <a href={safeReferenceUrl(item.referenceUrl)} target="_blank" rel="noreferrer" className="standard-link">참조 기준 · {item.standard} ↗</a> : <span className="standard-link static">검증 기준 · {item.standard}</span>)}
                <div className={`compare ${item.format === "latex" ? "latex-compare" : ""}`}><div><span>BEFORE</span><RichMathText value={item.before} forceMath={item.format === "latex"} /></div><i>→</i><div><span>AFTER</span><RichMathText value={item.after} forceMath={item.format === "latex"} /></div></div>
              </article>) : <div className="empty-filter"><Icon name="check" /><strong>이 조건에 해당하는 항목이 없습니다.</strong><button onClick={() => setActiveType("all")}>전체 결과 보기</button></div>}
            </section>
          </div>
        </section>
      )}
      <footer><YbmLogo /><p>교과서 개발 공정의 교정·교열과 교육과정 적합성 검토를 한곳에서 지원합니다.</p></footer>
    </main>
  );
}
