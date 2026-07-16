"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import PdfSplitter from "./PdfSplitter";
import { runLocalReview, type ReviewItem, type ReviewType } from "./localReview";

const gradeGroups = [
  { label: "초등", grades: ["1학년", "2학년", "3학년", "4학년", "5학년", "6학년"] },
  { label: "중등", grades: ["1학년", "2학년", "3학년"] },
  { label: "고등", grades: ["공통수학 1", "공통수학 2", "대수", "미적분Ⅰ", "확률과 통계"] },
];

const typeMeta: Record<ReviewType, { label: string; short: string; color: string }> = {
  curriculum: { label: "2022 수학과 교육과정", short: "교육과정", color: "blue" },
  style: { label: "내부 편집 통일 사항", short: "편집", color: "violet" },
  math: { label: "수학적 오류", short: "수학", color: "red" },
  scope: { label: "학년 범위 적합성", short: "범위", color: "amber" },
};

function Icon({ name }: { name: string }) {
  const icons: Record<string, string> = {
    upload: "↑", file: "▤", check: "✓", report: "▦", close: "×", download: "↓", search: "⌕", arrow: "→", shield: "◆",
  };
  return <span aria-hidden="true">{icons[name] ?? "•"}</span>;
}

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const guideInput = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState<"review" | "split">("review");
  const [grade, setGrade] = useState("초등 6학년");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [guideFile, setGuideFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [sourcePages, setSourcePages] = useState(0);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<"setup" | "analyzing" | "result">("setup");
  const [activeType, setActiveType] = useState<ReviewType | "all">("all");
  const [activePage, setActivePage] = useState(2);
  const [dragging, setDragging] = useState(false);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [score, setScore] = useState(100);
  const [analysisSummary, setAnalysisSummary] = useState("");
  const [analysisError, setAnalysisError] = useState("");

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const visibleItems = useMemo(
    () => reviewItems.filter((item) => item.page === activePage && (activeType === "all" || item.type === activeType)),
    [activePage, activeType, reviewItems],
  );
  const issuePages = useMemo(() => [...new Set(reviewItems.map((item) => item.page))], [reviewItems]);

  async function selectSource(file?: File) {
    if (!file) return;
    const valid = file.type === "application/pdf" || file.type.startsWith("image/") || /\.(pdf|png|jpe?g|webp)$/i.test(file.name);
    if (!valid) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setSourcePages(file.type.startsWith("image/") ? 1 : 0);
    setStage("setup");
    setProgress(0);
    setReviewItems([]); setAnalysisError(""); setAnalysisSummary("");
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
        setSourcePages(document.numPages);
        await document.destroy();
      } catch {
        setSourceFile(null); setSourcePages(0); setPreviewUrl("");
      }
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) { void selectSource(event.target.files?.[0]); }
  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false); void selectSource(event.dataTransfer.files?.[0]);
  }

  async function startAnalysis() {
    if (!sourceFile || !sourcePages) return;
    setStage("analyzing"); setProgress(3); setAnalysisError("");
    try {
      const result = await runLocalReview(sourceFile, guideFile, grade, setProgress);
      const items = result.items.filter((item) => item.page >= 1 && item.page <= sourcePages);
      setReviewItems(items); setScore(result.score); setAnalysisSummary(result.summary);
      setActivePage(items[0]?.page ?? 1); setActiveType("all");
      window.setTimeout(() => setStage("result"), 250);
    } catch (reason) {
      setAnalysisError(reason instanceof Error ? reason.message : "문서를 분석하는 중 문제가 발생했습니다.");
      setStage("setup"); setProgress(0);
    }
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(null); setPreviewUrl(""); setSourcePages(0); setProgress(0); setStage("setup"); setReviewItems([]); setAnalysisError(""); setAnalysisSummary(""); setScore(100);
    if (fileInput.current) fileInput.current.value = "";
  }

  function saveReport() {
    const rows = reviewItems.map((item) => `${item.page}쪽\t${typeMeta[item.type].label}\t${item.title}\t${item.before}\t${item.after}`).join("\n");
    const content = `수학 문제 검수 결과 보고서\n대상: ${grade}\n검수일: ${new Date().toLocaleDateString("ko-KR")}\n파일: ${sourceFile?.name ?? "-"}\n\n페이지\t검수 항목\t결과\tBEFORE\tAFTER\n${rows}`;
    const blob = new Blob(["\ufeff", content], { type: "text/tab-separated-values;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "수학_문제_검수_결과.tsv"; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  return (
    <main>
      <header className="topbar">
        <button className="brand brand-button" onClick={() => setTool("review")}><span className="brand-mark"><Icon name="check" /></span><span>수학도구</span><i>LOCAL</i></button>
        <nav className="tool-nav"><button className={tool === "review" ? "active" : ""} onClick={() => setTool("review")}>수학 문제 검수</button><button className={tool === "split" ? "active" : ""} onClick={() => setTool("split")}>PDF 나누기</button><a href="https://ncic.re.kr/" target="_blank" rel="noreferrer">교육과정 자료</a></nav>
      </header>

      {tool === "split" ? <PdfSplitter /> : stage !== "result" ? (
        <>
          <section className="hero" id="top">
            <div className="hero-badge"><Icon name="shield" /> 2022 개정 교육과정 기반</div>
            <h1>수학 문제 검수,<br /><em>더 정확하고 빠르게</em></h1>
            <p>PDF와 이미지를 올리면 파일 전송 없이 교육과정, 편집 기준, 계산 오류를<br className="desktop" /> 브라우저에서 자동 점검해 수정안을 제안합니다.</p>
            <div className="proof-row"><span><Icon name="check" /> NCIC 교육과정 참조</span><span><Icon name="check" /> 무료 로컬 OCR·규칙 검수</span><span><Icon name="check" /> 결과 보고서 저장</span></div>
          </section>

          <section className="flow-strip" aria-label="검수 절차">
            <div className="flow-step active"><b>01</b><span><strong>검수 기준 설정</strong><small>학년과 편집 기준 선택</small></span></div>
            <i>→</i><div className={`flow-step ${sourceFile ? "active" : ""}`}><b>02</b><span><strong>문제 파일 업로드</strong><small>PDF 또는 이미지 첨부</small></span></div>
            <i>→</i><div className={`flow-step ${stage === "analyzing" ? "active" : ""}`}><b>03</b><span><strong>로컬 자동 검수</strong><small>4개 기준 동시 분석</small></span></div>
            <i>→</i><div className="flow-step"><b>04</b><span><strong>결과 확인</strong><small>수정안 검토 및 저장</small></span></div>
          </section>

          <section className="setup-shell" id="workflow">
            {stage === "analyzing" ? (
              <div className="analyzing-card">
                <div className="orbit" style={{ background: `conic-gradient(#356fe6 ${progress}%, #e8edf5 0)` }}><span>{progress}%</span></div>
                <p className="section-label">브라우저 로컬 검수 진행 중</p>
                <h2>문항을 꼼꼼하게 살펴보고 있어요</h2>
                <p>{progress < 35 ? "문서에서 수식과 텍스트를 읽는 중입니다." : progress < 70 ? `${grade} 성취기준과 문항을 비교하고 있습니다.` : "오류를 분류하고 수정안을 정리하고 있습니다."}</p>
                <div className="analysis-track"><span style={{ width: `${progress}%` }} /></div>
                <div className="analysis-checks">
                  {(Object.keys(typeMeta) as ReviewType[]).map((type, index) => <span className={progress > (index + 1) * 20 ? "done" : ""} key={type}><Icon name="check" /> {typeMeta[type].label}</span>)}
                </div>
              </div>
            ) : (
              <div className="setup-grid">
                <section className="setup-card">
                  <div className="card-title"><b>1</b><div><h2>검수 기준을 설정해 주세요</h2><p>대상 학년과 내부 편집 기준을 선택합니다.</p></div></div>
                  <label className="field-label" htmlFor="grade">대상 학년 <span>필수</span></label>
                  <select id="grade" value={grade} onChange={(e) => setGrade(e.target.value)}>
                    {gradeGroups.map((group) => <optgroup label={group.label} key={group.label}>{group.grades.map((item) => <option key={`${group.label}-${item}`}>{group.label === "초등" ? `초등 ${item}` : group.label === "중등" ? `중등 ${item}` : item}</option>)}</optgroup>)}
                  </select>
                  <div className="curriculum-status"><span className="status-icon"><Icon name="check" /></span><div><strong>2022 개정 수학과 교육과정 연결됨</strong><small>NCIC 국가교육과정정보센터의 {grade} 성취기준을 참조합니다.</small></div><a href="https://ncic.re.kr/" target="_blank" rel="noreferrer">원문 보기 ↗</a></div>
                  <label className="field-label">내부 편집 통일 사항 <span className="optional">선택</span></label>
                  <input ref={guideInput} type="file" accept=".pdf,.txt,text/plain,application/pdf" hidden onChange={(e) => setGuideFile(e.target.files?.[0] ?? null)} />
                  <button className="guide-upload" type="button" onClick={() => guideInput.current?.click()}><Icon name="file" /><span><strong>{guideFile?.name ?? "편집 기준 파일을 첨부해 주세요"}</strong><small>텍스트형 PDF, TXT · BEFORE → AFTER 규칙 지원</small></span><em>{guideFile ? "변경" : "파일 선택"}</em></button>
                </section>

                <section className="setup-card">
                  <div className="card-title"><b>2</b><div><h2>검수할 문제를 올려 주세요</h2><p>여러 페이지가 포함된 PDF와 이미지를 지원합니다.</p></div></div>
                  <input ref={fileInput} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={onFileChange} />
                  {!sourceFile ? (
                    <div className={`dropzone ${dragging ? "dragging" : ""}`} onDragOver={(e) => e.preventDefault()} onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
                      <span className="upload-circle"><Icon name="upload" /></span><strong>파일을 여기에 끌어다 놓으세요</strong><p>또는</p><button type="button" onClick={() => fileInput.current?.click()}>내 컴퓨터에서 선택</button><small>PDF, PNG, JPG · 최대 50MB</small>
                    </div>
                  ) : (
                    <div className="selected-file"><span className="file-preview">{sourceFile.type.startsWith("image/") ? <img src={previewUrl} alt="업로드 미리보기" /> : <Icon name="file" />}</span><div><strong>{sourceFile.name}</strong><small>{(sourceFile.size / 1024 / 1024).toFixed(2)}MB · {sourcePages ? `${sourcePages}페이지 · 분석 준비 완료` : "페이지 확인 중"}</small></div><button onClick={reset} aria-label="파일 삭제"><Icon name="close" /></button></div>
                  )}
                  <button className="analyze-button" type="button" disabled={!sourceFile || !sourcePages} onClick={startAnalysis}><Icon name="search" /> 무료 검수 시작하기 <Icon name="arrow" /></button>
                  {analysisError && <p className="error-banner" role="alert">{analysisError}</p>}
                  <p className="privacy-copy"><Icon name="shield" /> 파일은 서버나 외부 API로 전송되지 않고 현재 브라우저에서만 처리됩니다.</p>
                </section>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="result-page" id="top">
          <div className="result-top"><div><button className="back-button" onClick={reset}>← 새 검수</button><p className="section-label">검수 완료</p><h1>수학 문제 검수 결과</h1><span>{sourceFile?.name} · {grade} · 총 {sourcePages}페이지</span></div><button className="save-report" onClick={saveReport}><Icon name="download" /> 결과 보고서 저장</button></div>
          <div className="summary-grid">
            <article className="score-card"><span>종합 적합도</span><strong>{score}<small>점</small></strong><p><i style={{ width: `${score}%` }} /></p><em>검토가 필요한 항목이 {reviewItems.length}개 있습니다.</em></article>
            {(Object.keys(typeMeta) as ReviewType[]).map((type) => { const count = reviewItems.filter((item) => item.type === type).length; return <button className={`metric-card ${typeMeta[type].color} ${activeType === type ? "selected" : ""}`} key={type} onClick={() => setActiveType(activeType === type ? "all" : type)}><span>{typeMeta[type].label}</span><strong>{count}<small>건</small></strong><em>{count === 0 ? "적합" : count > 1 ? "수정 필요" : "검토 권장"}</em></button>; })}
          </div>
          {analysisSummary && <p className="result-summary">{analysisSummary}</p>}

          <div className="review-layout">
            <aside className="page-sidebar"><div><strong>검토 페이지</strong><span>{issuePages.length}개</span></div>{issuePages.length ? issuePages.map((page) => <button key={page} className={activePage === page ? "active" : ""} onClick={() => setActivePage(page)}><span className={`page-thumb p${page}`}><i>{page}</i></span><em><strong>{page}페이지</strong><small>{reviewItems.filter((item) => item.page === page).length}개 항목</small></em></button>) : <p className="no-issue-pages">검토가 필요한 페이지가 없습니다.</p>}</aside>
            <section className="review-main">
              <div className="review-heading"><div><span className="section-label">PAGE {activePage}</span><h2>{activePage}페이지 검수 결과</h2></div><div className="filter-row"><button className={activeType === "all" ? "active" : ""} onClick={() => setActiveType("all")}>전체</button>{(Object.keys(typeMeta) as ReviewType[]).map((type) => <button className={activeType === type ? "active" : ""} key={type} onClick={() => setActiveType(type)}>{typeMeta[type].short}</button>)}</div></div>
              {visibleItems.length ? visibleItems.map((item) => <article className="issue-card" key={item.id}>
                <div className="issue-title"><span className={`tag ${typeMeta[item.type].color}`}>{typeMeta[item.type].label}</span><h3>{item.title}</h3><b>수정 필요</b></div>
                <p>{item.description}</p>{item.standard && <a href="https://ncic.re.kr/" target="_blank" rel="noreferrer" className="standard-link">참조 기준 · {item.standard} ↗</a>}
                <div className="compare"><div><span>BEFORE</span><p>{item.before}</p></div><i>→</i><div><span>AFTER</span><p>{item.after}</p></div></div>
              </article>) : <div className="empty-filter"><Icon name="check" /><strong>이 조건에 해당하는 항목이 없습니다.</strong><button onClick={() => setActiveType("all")}>전체 결과 보기</button></div>}
            </section>
          </div>
        </section>
      )}
      <footer><div className="brand"><span className="brand-mark"><Icon name="check" /></span><span>수학도구</span><i>LOCAL</i></div><p>수학 문제 검수와 PDF 분할을 외부 파일 전송 없이 안전하게 처리하세요.</p></footer>
    </main>
  );
}
