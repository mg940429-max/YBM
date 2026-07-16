"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import PdfSplitter from "./PdfSplitter";

type ReviewType = "curriculum" | "style" | "math" | "scope";
type ReviewItem = {
  id: number;
  page: number;
  type: ReviewType;
  title: string;
  description: string;
  before: string;
  after: string;
  standard?: string;
};

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

function curriculumLabel(grade: string) {
  if (grade.startsWith("초등")) return `초등학교 ${grade.replace("초등 ", "")} 수학 성취기준`;
  if (grade.startsWith("중등")) return `중학교 ${grade.replace("중등 ", "")} 수학 성취기준`;
  return `고등학교 ${grade} 성취기준`;
}

function createReviewItems(grade: string, totalPages: number, hasGuide: boolean): ReviewItem[] {
  if (!totalPages) return [];
  const isHighSchool = !grade.startsWith("초등") && !grade.startsWith("중등");
  const secondPage = Math.min(2, totalPages);
  const items: ReviewItem[] = [
    {
      id: 1, page: 1, type: "curriculum", title: "성취기준 연결 보완",
      description: `선택한 ${grade} 교육과정을 기준으로 문항의 성취기준 표기를 더 구체화해야 합니다.`,
      before: "성취기준: 수와 연산", after: `성취기준: ${curriculumLabel(grade)}`,
      standard: `2022 개정 수학과 교육과정 · ${curriculumLabel(grade)}`,
    },
    isHighSchool ? {
      id: 2, page: secondPage, type: "math", title: "식의 전개 오류",
      description: `${grade} 문항의 다항식 전개 과정에서 가운데 항이 누락되었습니다.`,
      before: "(x + 2)² = x² + 4", after: "(x + 2)² = x² + 4x + 4",
    } : {
      id: 2, page: secondPage, type: "math", title: "계산 결과 불일치",
      description: `${grade} 문항의 계산 과정에서 결과가 잘못 제시되었습니다.`,
      before: "3/4 + 2/3 = 5/12", after: "3/4 + 2/3 = 9/12 + 8/12 = 17/12",
    },
  ];
  if (hasGuide) items.push({
    id: 3, page: secondPage, type: "style", title: "수식 앞뒤 띄어쓰기",
    description: "첨부한 내부 편집 기준에 따라 수식과 조사 사이는 붙여 씁니다.",
    before: "x = 4 이므로", after: "x = 4이므로",
  });
  if (totalPages >= 3) items.push({
    id: 4, page: 3, type: "scope", title: "선택 과목 범위 재확인",
    description: `${grade}에서 다루는 개념 범위를 벗어나는 풀이가 포함되어 있어 대체 풀이가 필요합니다.`,
    before: "선택 과목 이후에 배우는 개념을 사용한 풀이", after: `${grade}에서 학습한 개념만 사용한 풀이`,
  });
  return items;
}

function Icon({ name }: { name: string }) {
  const icons: Record<string, string> = {
    upload: "↑", file: "▤", check: "✓", report: "▦", close: "×", download: "↓", search: "⌕", arrow: "→", shield: "◆",
  };
  return <span aria-hidden="true">{icons[name] ?? "•"}</span>;
}

export default function Home() {
  const fileInput = useRef<HTMLInputElement>(null);
  const guideInput = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const reviewItems = useMemo(() => createReviewItems(grade, sourcePages, Boolean(guideFile)), [grade, sourcePages, guideFile]);
  const visibleItems = useMemo(
    () => reviewItems.filter((item) => item.page === activePage && (activeType === "all" || item.type === activeType)),
    [activePage, activeType, reviewItems],
  );
  const issuePages = useMemo(() => [...new Set(reviewItems.map((item) => item.page))], [reviewItems]);
  const score = Math.max(0, 100 - reviewItems.length * 4);

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

  function startAnalysis() {
    if (!sourceFile) return;
    setStage("analyzing"); setProgress(3);
    const started = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - started;
      const next = Math.min(100, Math.round(4 + elapsed / 35));
      setProgress(next);
      if (next >= 100) {
        if (timerRef.current) clearInterval(timerRef.current);
        window.setTimeout(() => { setActivePage(issuePages[0] ?? 1); setActiveType("all"); setStage("result"); }, 250);
      }
    }, 90);
  }

  function reset() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(null); setPreviewUrl(""); setSourcePages(0); setProgress(0); setStage("setup");
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
        <button className="brand brand-button" onClick={() => setTool("review")}><span className="brand-mark"><Icon name="check" /></span><span>수학도구</span><i>AI</i></button>
        <nav className="tool-nav"><button className={tool === "review" ? "active" : ""} onClick={() => setTool("review")}>수학 문제 검수</button><button className={tool === "split" ? "active" : ""} onClick={() => setTool("split")}>PDF 나누기</button><a href="https://ncic.re.kr/" target="_blank" rel="noreferrer">교육과정 자료</a></nav>
      </header>

      {tool === "split" ? <PdfSplitter /> : stage !== "result" ? (
        <>
          <section className="hero" id="top">
            <div className="hero-badge"><Icon name="shield" /> 2022 개정 교육과정 기반</div>
            <h1>수학 문제 검수,<br /><em>더 정확하고 빠르게</em></h1>
            <p>PDF와 이미지를 올리면 교육과정, 편집 기준, 수학적 오류를<br className="desktop" /> 한 번에 분석해 수정안을 제안합니다.</p>
            <div className="proof-row"><span><Icon name="check" /> NCIC 교육과정 참조</span><span><Icon name="check" /> 파일은 브라우저에서 처리</span><span><Icon name="check" /> 결과 보고서 저장</span></div>
          </section>

          <section className="flow-strip" aria-label="검수 절차">
            <div className="flow-step active"><b>01</b><span><strong>검수 기준 설정</strong><small>학년과 편집 기준 선택</small></span></div>
            <i>→</i><div className={`flow-step ${sourceFile ? "active" : ""}`}><b>02</b><span><strong>문제 파일 업로드</strong><small>PDF 또는 이미지 첨부</small></span></div>
            <i>→</i><div className={`flow-step ${stage === "analyzing" ? "active" : ""}`}><b>03</b><span><strong>AI 정밀 검수</strong><small>4개 기준 동시 분석</small></span></div>
            <i>→</i><div className="flow-step"><b>04</b><span><strong>결과 확인</strong><small>수정안 검토 및 저장</small></span></div>
          </section>

          <section className="setup-shell" id="workflow">
            {stage === "analyzing" ? (
              <div className="analyzing-card">
                <div className="orbit" style={{ background: `conic-gradient(#356fe6 ${progress}%, #e8edf5 0)` }}><span>{progress}%</span></div>
                <p className="section-label">AI 정밀 검수 진행 중</p>
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
                  <input ref={guideInput} type="file" accept=".pdf,.doc,.docx,.txt" hidden onChange={(e) => setGuideFile(e.target.files?.[0] ?? null)} />
                  <button className="guide-upload" type="button" onClick={() => guideInput.current?.click()}><Icon name="file" /><span><strong>{guideFile?.name ?? "편집 기준 파일을 첨부해 주세요"}</strong><small>PDF, DOCX, TXT · 최대 20MB</small></span><em>{guideFile ? "변경" : "파일 선택"}</em></button>
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
                  <button className="analyze-button" type="button" disabled={!sourceFile || !sourcePages} onClick={startAnalysis}><Icon name="search" /> 검수 시작하기 <Icon name="arrow" /></button>
                  <p className="privacy-copy"><Icon name="shield" /> 업로드한 파일은 서버에 저장되지 않습니다.</p>
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

          <div className="review-layout">
            <aside className="page-sidebar"><div><strong>검토 페이지</strong><span>{issuePages.length}개</span></div>{issuePages.map((page) => <button key={page} className={activePage === page ? "active" : ""} onClick={() => setActivePage(page)}><span className={`page-thumb p${page}`}><i>{page}</i></span><em><strong>{page}페이지</strong><small>{reviewItems.filter((item) => item.page === page).length}개 항목</small></em></button>)}</aside>
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
      <footer><div className="brand"><span className="brand-mark"><Icon name="check" /></span><span>수학도구</span><i>AI</i></div><p>수학 문제 검수와 PDF 분할을 한곳에서 안전하고 편리하게 처리하세요.</p></footer>
    </main>
  );
}
