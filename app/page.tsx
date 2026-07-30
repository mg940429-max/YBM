"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import PdfSplitter from "./PdfSplitter";
import { type ReviewItem, type ReviewType } from "./localReview";

const NCIC_URL = "https://ncic.re.kr/inv/org/list.do";
const KOSAC_URL = "https://www.kosac.re.kr/menus/270/boards/386/posts/39295";

const subjects = ["수학", "영어", "체육", "음악", "보건", "한문", "정보"] as const;
type ReviewScope = "proofreading" | "screening";

const gradeGroups = [
  { label: "초등", grades: ["1학년", "2학년", "3학년", "4학년", "5학년", "6학년"] },
  { label: "중등", grades: ["1학년", "2학년", "3학년"] },
  { label: "고등", grades: ["공통수학 1", "공통수학 2", "대수", "미적분Ⅰ", "확률과 통계"] },
];

const scopeMeta: Record<ReviewScope, { label: string; description: string }> = {
  proofreading: { label: "교정·교열", description: "수학적 오류, 표기, 문장과 내부 편집 기준을 확인합니다." },
  screening: { label: "교육과정 적합성", description: "2022 개정 교육과정과 검정 심사 기준의 부적합 가능성을 확인합니다." },
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

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const guideInput = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragDepthRef = useRef(0);
  const [tool, setTool] = useState<"review" | "split">("review");
  const [subject, setSubject] = useState<(typeof subjects)[number]>("수학");
  const [reviewScope, setReviewScope] = useState<ReviewScope>("proofreading");
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
  const [analysisError, setAnalysisError] = useState("");
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const reviewTypes: ReviewType[] = reviewScope === "proofreading"
    ? ["math", "style"]
    : ["screening", "curriculum", "scope"];

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
        const payload = await response.json() as { configured?: boolean };
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
    if (file.size > 20 * 1024 * 1024) { setAnalysisError("검수 파일은 최대 20MB까지 업로드할 수 있습니다."); return; }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setSourcePages(file.type.startsWith("image/") ? 1 : 0);
    setStage("setup"); setProgress(0); setReviewItems([]); setAnalysisError(""); setAnalysisSummary("");
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
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
      form.append("reviewScope", reviewScope);
      form.append("totalPages", String(sourcePages));
      if (guideFile) form.append("guide", guideFile);
      const response = await fetch("/api/review", { method: "POST", body: form });
      const payload = await response.json() as { error?: string; score?: number; summary?: string; items?: ReviewItem[] };
      if (!response.ok) throw new Error(payload.error || "AI 교과서 사전 점검 요청에 실패했습니다.");
      const result = {
        score: Math.max(0, Math.min(100, Number(payload.score) || 0)),
        summary: payload.summary || "AI 교과서 사전 점검이 완료되었습니다.",
        items: Array.isArray(payload.items) ? payload.items : [],
      };
      setProgress(100);
      const items = result.items.filter((item) => item.page >= 1 && item.page <= sourcePages);
      setReviewItems(items); setScore(result.score); setAnalysisSummary(result.summary);
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
    setReviewItems([]); setAnalysisError(""); setAnalysisSummary(""); setScore(100);
    if (fileInput.current) fileInput.current.value = "";
  }

  function saveReport() {
    const rows = reviewItems.map((item) => [
      `${item.page}쪽`, typeMeta[item.type].group, typeMeta[item.type].label, item.judgment ?? "검토 필요",
      item.title, item.description, item.standard ?? "", item.before, item.after, item.referenceUrl ?? "",
    ].join("\t")).join("\n");
    const content = `YBM 교과서 사전 점검 결과 보고서\n과목: ${subject}\n대상: ${grade}\n점검 범위: ${scopeMeta[reviewScope].label}\n점검일: ${new Date().toLocaleDateString("ko-KR")}\n파일: ${sourceFile?.name ?? "-"}\n종합 적합도: ${score}점\n\n페이지\t영역\t세부 항목\t판단\t제목\t설명\t참조 기준\tBEFORE\tAFTER\t출처\n${rows}`;
    const blob = new Blob(["\ufeff", content], { type: "text/tab-separated-values;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `YBM_${subject}_교과서_사전점검_결과.tsv`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  return (
    <main>
      <header className="topbar">
        <button className="brand brand-button ybm-brand" onClick={() => setTool("review")}>
          <YbmLogo /><span className="brand-divider" /><span>교과서 AI 모의 심사</span>
          <i>{aiConfigured === null ? "확인 중" : aiConfigured ? "AI 연결" : "API 필요"}</i>
        </button>
        <nav className="tool-nav">
          <button className={tool === "review" ? "active" : ""} onClick={() => setTool("review")}>교과서 사전 점검</button>
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
            <p>교정·교열 또는 교육과정 적합성을 선택해 페이지별 검토 결과와 수정안을 확인하세요.</p>
            <div className="proof-row">
              <span><Icon name="check" /> NCIC 공식 교육과정 참조</span>
              <span><Icon name="check" /> 수학 문항·풀이 정밀 검증</span>
              <span><Icon name="check" /> 검정 심사 전 사전 점검</span>
            </div>
          </section>

          <section className="flow-strip" aria-label="점검 절차">
            <div className="flow-step active"><b>01</b><span><strong>과목·범위 설정</strong><small>수학 및 점검 영역 선택</small></span></div>
            <i>→</i><div className={`flow-step ${sourceFile ? "active" : ""}`}><b>02</b><span><strong>교과서 업로드</strong><small>PDF 또는 이미지 첨부</small></span></div>
            <i>→</i><div className={`flow-step ${stage === "analyzing" ? "active" : ""}`}><b>03</b><span><strong>AI 선택 점검</strong><small>선택 영역 집중 분석</small></span></div>
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

          <section className="review-workspace" aria-labelledby="review-mode-title">
            <aside className="review-mode-panel">
              <span>STEP 02</span>
              <h2 id="review-mode-title">점검 메뉴</h2>
              <nav aria-label="점검 영역">
                {(Object.keys(scopeMeta) as ReviewScope[]).map((scope, index) => <button type="button" key={scope} className={reviewScope === scope ? "active" : ""} onClick={() => setReviewScope(scope)}>
                  <b>{String(index + 1).padStart(2, "0")}</b><div><strong>{scopeMeta[scope].label}</strong><small>{scopeMeta[scope].description}</small></div><i>→</i>
                </button>)}
              </nav>
              <p>두 점검은 기준이 달라 각각 실행해야 더 정확한 결과를 얻을 수 있습니다.</p>
            </aside>

            <section className="setup-shell review-workarea" id="workflow">
            {stage === "analyzing" ? (
              <div className="analyzing-card">
                <div className="orbit" style={{ background: `conic-gradient(#0757a5 ${progress}%, #e8edf5 0)` }}><span>{progress}%</span></div>
                <p className="section-label">AI 교과서 사전 점검 진행 중</p>
                <h2>{subject} 교과서를 심사 기준에 맞춰 살펴보고 있어요</h2>
                <p>{progress < 35 ? "문서에서 본문, 수식과 편집 요소를 읽는 중입니다." : progress < 70 ? `${grade} 교육과정과 성취기준을 비교하고 있습니다.` : "부적합 가능성을 분류하고 수정안을 정리하고 있습니다."}</p>
                <div className="analysis-track"><span style={{ width: `${progress}%` }} /></div>
                <div className="analysis-checks">
                  {reviewTypes.map((type, index) => <span className={progress > (index + 1) * (70 / reviewTypes.length) ? "done" : ""} key={type}><Icon name="check" /> {typeMeta[type].label}</span>)}
                </div>
              </div>
            ) : (
              <div className="setup-grid textbook-setup">
                <section className="setup-card">
                  <div className="card-title"><b>3</b><div><h2>{reviewScope === "proofreading" ? "교정 기준을 설정해 주세요" : "교육과정 기준을 설정해 주세요"}</h2><p>{scopeMeta[reviewScope].description}</p></div></div>
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
                  <div className="card-title"><b>4</b><div><h2>점검할 교과서를 올려 주세요</h2><p>여러 페이지가 포함된 PDF와 이미지를 지원합니다.</p></div></div>
                  <input ref={fileInput} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={onFileChange} />
                  {dragging && <div className="drop-capture" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}><div><span><Icon name="upload" /></span><strong>파일을 놓아 업로드하세요</strong><small>PDF, PNG, JPG, WEBP</small></div></div>}
                  {!sourceFile ? (
                    <div className={`dropzone ${dragging ? "dragging" : ""}`} role="button" tabIndex={0} onClick={() => fileInput.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInput.current?.click(); }}>
                      <span className="upload-circle"><Icon name="upload" /></span><strong>파일을 이 영역에 끌어다 놓으세요</strong><p>또는</p>
                      <button type="button" onClick={(event) => { event.stopPropagation(); fileInput.current?.click(); }}>내 컴퓨터에서 선택</button><small>PDF, PNG, JPG, WEBP · 최대 20MB</small>
                    </div>
                  ) : (
                    <div className="selected-file"><span className="file-preview">{sourceFile.type.startsWith("image/") ? <img src={previewUrl} alt="업로드 미리보기" /> : <Icon name="file" />}</span><div><strong>{sourceFile.name}</strong><small>{(sourceFile.size / 1024 / 1024).toFixed(2)}MB · {sourcePages ? `${sourcePages}페이지 · 분석 준비 완료` : "페이지 확인 중"}</small></div><button onClick={reset} aria-label="파일 삭제">×</button></div>
                  )}
                  <button className="analyze-button" type="button" disabled={!sourceFile || !sourcePages || aiConfigured !== true} onClick={startAnalysis}><Icon name="search" /> {aiConfigured === null ? "API 연결 확인 중" : aiConfigured ? `${scopeMeta[reviewScope].label} 시작하기` : "API 키 연결 필요"} <Icon name="arrow" /></button>
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
          <div className="result-top"><div><button className="back-button" onClick={reset}>← 새 점검</button><p className="section-label">사전 점검 완료</p><h1>{subject} 교과서 점검 결과</h1><span>{sourceFile?.name} · {grade} · 총 {sourcePages}페이지 · {scopeMeta[reviewScope].label}</span></div><button className="save-report" onClick={saveReport}><Icon name="download" /> 결과 보고서 저장</button></div>
          <div className="result-disclaimer">AI가 발견한 ‘부적합 가능성’과 수정 권고입니다. 편집자가 공식 원문과 대조하여 최종 판단해 주세요.</div>
          <div className={`summary-grid textbook-summary ${reviewScope}`}>
            <article className="score-card"><span>종합 적합도</span><strong>{score}<small>점</small></strong><p><i style={{ width: `${score}%` }} /></p><em>검토가 필요한 항목이 {reviewItems.length}개 있습니다.</em></article>
            {reviewTypes.map((type) => {
              const count = reviewItems.filter((item) => item.type === type).length;
              return <button className={`metric-card ${typeMeta[type].color} ${activeType === type ? "selected" : ""}`} key={type} onClick={() => setActiveType(activeType === type ? "all" : type)}><span>{typeMeta[type].label}</span><strong>{count}<small>건</small></strong><em>{count === 0 ? "발견 없음" : count > 1 ? "검토 필요" : "확인 권장"}</em></button>;
            })}
          </div>
          {analysisSummary && <RichMathText value={analysisSummary} className="result-summary" />}

          <div className="review-layout">
            <aside className="page-sidebar"><div><strong>검토 페이지</strong><span>{issuePages.length}개</span></div>{issuePages.length ? issuePages.map((page) => <button key={page} className={activePage === page ? "active" : ""} onClick={() => setActivePage(page)}><span className={`page-thumb p${page}`}><i>{page}</i></span><em><strong>{page}페이지</strong><small>{reviewItems.filter((item) => item.page === page).length}개 항목</small></em></button>) : <p className="no-issue-pages">검토가 필요한 페이지가 없습니다.</p>}</aside>
            <section className="review-main">
              <div className="review-heading"><div><span className="section-label">PAGE {activePage}</span><h2>{activePage}페이지 점검 결과</h2></div><div className="filter-row"><button className={activeType === "all" ? "active" : ""} onClick={() => setActiveType("all")}>전체</button>{reviewTypes.map((type) => <button className={activeType === type ? "active" : ""} key={type} onClick={() => setActiveType(type)}>{typeMeta[type].short}</button>)}</div></div>
              {visibleItems.length ? visibleItems.map((item) => <article className="issue-card" key={item.id}>
                <div className="issue-title"><span className={`tag ${typeMeta[item.type].color}`}>{typeMeta[item.type].label}</span><h3>{item.title}</h3><b>{item.judgment ?? "검토 필요"}</b></div>
                <RichMathText value={item.description} />
                {item.standard && <a href={safeReferenceUrl(item.referenceUrl)} target="_blank" rel="noreferrer" className="standard-link">참조 기준 · {item.standard} ↗</a>}
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
