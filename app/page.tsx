"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";

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

const sampleItems: ReviewItem[] = [
  {
    id: 1, page: 2, type: "math", title: "계산 결과 불일치",
    description: "분수의 덧셈 과정에서 통분한 분자의 합이 잘못 계산되었습니다.",
    before: "3/4 + 2/3 = 5/12", after: "3/4 + 2/3 = 9/12 + 8/12 = 17/12",
  },
  {
    id: 2, page: 2, type: "style", title: "수식 앞뒤 띄어쓰기",
    description: "내부 편집 기준에 따라 수식과 조사 사이는 붙여 씁니다.",
    before: "x = 4 이므로", after: "x = 4이므로",
  },
  {
    id: 3, page: 4, type: "curriculum", title: "성취기준 연결 보완",
    description: "문항 의도는 적합하나 적용한 성취기준을 더 구체적으로 표기해야 합니다.",
    before: "[6수01] 분수의 계산", after: "[6수01-11] 분수의 나눗셈 원리를 이해하고 계산할 수 있다.",
    standard: "2022 개정 수학과 교육과정 [6수01-11]",
  },
  {
    id: 4, page: 5, type: "scope", title: "선행 개념 사용",
    description: "선택한 학년에서 아직 학습하지 않은 미지수 두 개의 연립방정식을 풀이에 사용했습니다.",
    before: "x + y = 12, 2x - y = 3", after: "그림과 표를 이용해 두 양의 관계를 단계적으로 비교",
  },
  {
    id: 5, page: 7, type: "style", title: "문장 종결 표현 통일",
    description: "발문은 내부 편집 기준의 ‘구하여라’ 형식으로 통일합니다.",
    before: "답을 구하세요.", after: "답을 구하여라.",
  },
];

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
  const [grade, setGrade] = useState("초등 6학년");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [guideFile, setGuideFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<"setup" | "analyzing" | "result">("setup");
  const [activeType, setActiveType] = useState<ReviewType | "all">("all");
  const [activePage, setActivePage] = useState(2);
  const [dragging, setDragging] = useState(false);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const visibleItems = useMemo(
    () => sampleItems.filter((item) => item.page === activePage && (activeType === "all" || item.type === activeType)),
    [activePage, activeType],
  );
  const issuePages = [...new Set(sampleItems.map((item) => item.page))];

  function selectSource(file?: File) {
    if (!file) return;
    const valid = file.type === "application/pdf" || file.type.startsWith("image/") || /\.(pdf|png|jpe?g|webp)$/i.test(file.name);
    if (!valid) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setStage("setup");
    setProgress(0);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) { selectSource(event.target.files?.[0]); }
  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault(); setDragging(false); selectSource(event.dataTransfer.files?.[0]);
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
        window.setTimeout(() => setStage("result"), 250);
      }
    }, 90);
  }

  function reset() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setSourceFile(null); setPreviewUrl(""); setProgress(0); setStage("setup");
    if (fileInput.current) fileInput.current.value = "";
  }

  function saveReport() {
    const rows = sampleItems.map((item) => `${item.page}쪽\t${typeMeta[item.type].label}\t${item.title}\t${item.before}\t${item.after}`).join("\n");
    const content = `수학 문제 검수 결과 보고서\n대상: ${grade}\n검수일: ${new Date().toLocaleDateString("ko-KR")}\n파일: ${sourceFile?.name ?? "-"}\n\n페이지\t검수 항목\t결과\tBEFORE\tAFTER\n${rows}`;
    const blob = new Blob(["\ufeff", content], { type: "text/tab-separated-values;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "수학_문제_검수_결과.tsv"; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top"><span className="brand-mark"><Icon name="check" /></span><span>수학검수</span><i>AI</i></a>
        <nav><a href="#workflow">검수하기</a><a href="https://ncic.re.kr/" target="_blank" rel="noreferrer">교육과정 자료</a><button type="button" className="help-button">도움말</button></nav>
      </header>

      {stage !== "result" ? (
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
                    <div className="selected-file"><span className="file-preview">{sourceFile.type.startsWith("image/") ? <img src={previewUrl} alt="업로드 미리보기" /> : <Icon name="file" />}</span><div><strong>{sourceFile.name}</strong><small>{(sourceFile.size / 1024 / 1024).toFixed(2)}MB · 분석 준비 완료</small></div><button onClick={reset} aria-label="파일 삭제"><Icon name="close" /></button></div>
                  )}
                  <button className="analyze-button" type="button" disabled={!sourceFile} onClick={startAnalysis}><Icon name="search" /> 검수 시작하기 <Icon name="arrow" /></button>
                  <p className="privacy-copy"><Icon name="shield" /> 업로드한 파일은 서버에 저장되지 않습니다.</p>
                </section>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="result-page" id="top">
          <div className="result-top"><div><button className="back-button" onClick={reset}>← 새 검수</button><p className="section-label">검수 완료</p><h1>수학 문제 검수 결과</h1><span>{sourceFile?.name} · {grade} · 총 8페이지</span></div><button className="save-report" onClick={saveReport}><Icon name="download" /> 결과 보고서 저장</button></div>
          <div className="summary-grid">
            <article className="score-card"><span>종합 적합도</span><strong>82<small>점</small></strong><p><i style={{ width: "82%" }} /></p><em>검토가 필요한 항목이 5개 있습니다.</em></article>
            {(Object.keys(typeMeta) as ReviewType[]).map((type) => { const count = sampleItems.filter((item) => item.type === type).length; return <button className={`metric-card ${typeMeta[type].color} ${activeType === type ? "selected" : ""}`} key={type} onClick={() => setActiveType(activeType === type ? "all" : type)}><span>{typeMeta[type].label}</span><strong>{count}<small>건</small></strong><em>{count > 1 ? "수정 필요" : "검토 권장"}</em></button>; })}
          </div>

          <div className="review-layout">
            <aside className="page-sidebar"><div><strong>검토 페이지</strong><span>{issuePages.length}개</span></div>{issuePages.map((page) => <button key={page} className={activePage === page ? "active" : ""} onClick={() => setActivePage(page)}><span className={`page-thumb p${page}`}><i>{page}</i></span><em><strong>{page}페이지</strong><small>{sampleItems.filter((item) => item.page === page).length}개 항목</small></em></button>)}</aside>
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
      <footer><div className="brand"><span className="brand-mark"><Icon name="check" /></span><span>수학검수</span><i>AI</i></div><p>교재 편집자의 판단을 돕는 검수 보조 도구입니다. 최종 반영 전 전문가의 확인을 권장합니다.</p></footer>
    </main>
  );
}
