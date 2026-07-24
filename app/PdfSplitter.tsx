"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";

type Range = { start: number; end: number };
type OutputFile = Range & { name: string; blob: Blob };
type WritableFile = { write(data: Blob): Promise<void>; close(): Promise<void> };
type DirectoryHandle = { getFileHandle(name: string, options: { create: boolean }): Promise<{ createWritable(): Promise<WritableFile> }> };

declare global { interface Window { showDirectoryPicker?: () => Promise<DirectoryHandle> } }

function fileName(source: string, range: Range) {
  return `${source.replace(/\.pdf$/i, "")}_${range.start}p-${range.end}p.pdf`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 800);
}

function parseRanges(value: string, total: number): { ranges: Range[]; error: string } {
  if (!value.trim()) return { ranges: [], error: "분할할 페이지 범위를 입력해 주세요." };
  const ranges: Range[] = [];
  for (const part of value.split(",")) {
    const match = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (!match) return { ranges: [], error: "1-3, 4-7 형식으로 입력해 주세요." };
    const start = Number(match[1]); const end = Number(match[2]);
    if (start < 1 || end < start || end > total) return { ranges: [], error: `1부터 ${total} 사이의 올바른 범위를 입력해 주세요.` };
    ranges.push({ start, end });
  }
  return { ranges, error: "" };
}

export default function PdfSplitter() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [preview, setPreview] = useState("");
  const [mode, setMode] = useState<"even" | "range">("even");
  const [pagesPerFile, setPagesPerFile] = useState(3);
  const [rangeText, setRangeText] = useState("1-1");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [outputs, setOutputs] = useState<OutputFile[]>([]);

  const evenRanges = useMemo(() => {
    const list: Range[] = [];
    for (let start = 1; start <= totalPages; start += pagesPerFile) list.push({ start, end: Math.min(totalPages, start + pagesPerFile - 1) });
    return list;
  }, [pagesPerFile, totalPages]);
  const parsed = useMemo(() => parseRanges(rangeText, totalPages), [rangeText, totalPages]);
  const ranges = mode === "even" ? evenRanges : parsed.ranges;
  const rangeError = mode === "range" ? parsed.error : "";

  async function load(selected?: File) {
    if (!selected) return;
    if (selected.type !== "application/pdf" && !selected.name.toLowerCase().endsWith(".pdf")) { setError("PDF 파일만 선택할 수 있습니다."); return; }
    setBusy(true); setError(""); setOutputs([]); setProgress(12); setFile(selected);
    try {
      const buffer = await selected.arrayBuffer();
      setBytes(buffer); setProgress(38);
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const pdfDocument = await pdfjs.getDocument({ data: buffer.slice(0) }).promise;
      setTotalPages(pdfDocument.numPages); setPagesPerFile(Math.min(3, pdfDocument.numPages)); setRangeText(`1-${pdfDocument.numPages}`); setProgress(72);
      const page = await pdfDocument.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(1.5, 420 / base.width) });
      const canvas = document.createElement("canvas"); const context = canvas.getContext("2d");
      if (!context) throw new Error("미리보기를 만들 수 없습니다.");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      setPreview(canvas.toDataURL("image/jpeg", .86)); await pdfDocument.destroy(); setProgress(100);
    } catch { setError("PDF를 읽을 수 없습니다. 파일이 손상되었거나 암호로 보호되었는지 확인해 주세요."); setFile(null); }
    finally { setBusy(false); }
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) { void load(event.target.files?.[0]); }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); void load(event.dataTransfer.files?.[0]); }
  function clear() { setFile(null); setBytes(null); setTotalPages(0); setPreview(""); setOutputs([]); setProgress(0); setError(""); if (inputRef.current) inputRef.current.value = ""; }

  async function build(directory?: DirectoryHandle) {
    if (!file || !bytes || !ranges.length || rangeError) return;
    setBusy(true); setError(""); setOutputs([]); setProgress(0);
    try {
      const source = await PDFDocument.load(bytes.slice(0)); const next: OutputFile[] = [];
      for (let index = 0; index < ranges.length; index += 1) {
        const range = ranges[index]; const output = await PDFDocument.create();
        const indices = Array.from({ length: range.end - range.start + 1 }, (_, offset) => range.start - 1 + offset);
        const pages = await output.copyPages(source, indices); pages.forEach((page) => output.addPage(page));
        const result = await output.save(); const blob = new Blob([result as BlobPart], { type: "application/pdf" }); const name = fileName(file.name, range);
        if (directory) { const handle = await directory.getFileHandle(name, { create: true }); const writable = await handle.createWritable(); await writable.write(blob); await writable.close(); }
        next.push({ ...range, name, blob }); setOutputs([...next]); setProgress(Math.round(((index + 1) / ranges.length) * 100));
      }
    } catch { setError("PDF 파일을 만드는 중 문제가 발생했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }

  async function chooseFolder() {
    if (!window.showDirectoryPicker) return;
    try { const directory = await window.showDirectoryPicker(); await build(directory); }
    catch (reason) { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError("선택한 폴더에 저장할 수 없습니다."); }
  }

  async function downloadAll() {
    for (const item of outputs) { download(item.blob, item.name); await new Promise((resolve) => window.setTimeout(resolve, 160)); }
  }

  return <section className="splitter-page">
    <div className="splitter-hero"><div className="hero-badge">브라우저에서 안전하게 처리</div><h1>PDF를 원하는 만큼<br /><em>깔끔하게 나누세요</em></h1><p>서버 업로드 없이 페이지 수 또는 직접 지정한 범위로 PDF를 분할합니다.</p></div>
    <div className="splitter-shell">
      {!file ? <div className={`pdf-dropzone ${dragging ? "dragging" : ""}`} onDragEnter={() => setDragging(true)} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={onChange} hidden />
        <span className="pdf-upload-icon">PDF</span><h2>PDF 파일을 여기에 끌어다 놓으세요</h2><p>또는 아래 버튼을 눌러 파일을 선택하세요.</p><button onClick={() => inputRef.current?.click()} disabled={busy}>PDF 파일 선택</button><small>파일은 외부로 전송되지 않고 이 브라우저 안에서만 처리됩니다.</small>{error && <div className="split-error">{error}</div>}
      </div> : <div className="split-workspace">
        <aside className="split-preview"><div className="split-panel-title"><div><small>선택한 PDF</small><h2>파일 확인</h2></div><button onClick={clear}>다른 파일</button></div><div className="pdf-page-preview">{preview ? <img src={preview} alt={`${file.name} 첫 페이지 미리보기`} /> : <span>불러오는 중</span>}<i>1 / {totalPages}</i></div><div className="split-file-info"><span>PDF</span><div><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></div><b>{totalPages}<small>페이지</small></b></div></aside>
        <section className="split-settings"><div className="split-panel-title"><div><small>분할 방식</small><h2>어떻게 나눌까요?</h2></div></div><div className="split-tabs"><button className={mode === "even" ? "active" : ""} onClick={() => { setMode("even"); setOutputs([]); }}>균등 분할</button><button className={mode === "range" ? "active" : ""} onClick={() => { setMode("range"); setOutputs([]); }}>범위 지정</button></div>
          {mode === "even" ? <div className="split-control"><label>파일 하나에 들어갈 페이지 수</label><div className="split-number"><button onClick={() => { setPagesPerFile(Math.max(1, pagesPerFile - 1)); setOutputs([]); }}>−</button><input type="number" min="1" max={totalPages} value={pagesPerFile} onChange={(event) => { setPagesPerFile(Math.max(1, Math.min(totalPages, Number(event.target.value) || 1))); setOutputs([]); }} /><span>페이지씩</span><button onClick={() => { setPagesPerFile(Math.min(totalPages, pagesPerFile + 1)); setOutputs([]); }}>＋</button></div><p>총 <strong>{evenRanges.length}개</strong>의 PDF 파일이 만들어집니다.</p></div> : <div className="split-control"><label htmlFor="split-ranges">페이지 범위</label><input id="split-ranges" className={`range-input ${rangeError ? "error" : ""}`} value={rangeText} onChange={(event) => { setRangeText(event.target.value); setOutputs([]); }} placeholder="예: 1-3, 4-7, 8-10" /><p className={rangeError ? "range-error" : ""}>{rangeError || "쉼표로 구분해 여러 범위를 한 번에 입력할 수 있습니다."}</p></div>}
          <div className="split-result-list"><div><strong>생성될 파일</strong><span>{ranges.length}개</span></div>{ranges.slice(0, 5).map((range) => <p key={`${range.start}-${range.end}`}><b>PDF</b><span>{fileName(file.name, range)}</span><small>{range.end - range.start + 1}페이지</small></p>)}{ranges.length > 5 && <em>외 {ranges.length - 5}개 파일</em>}</div>
          {busy && <div className="split-progress"><span style={{ width: `${progress}%` }} /></div>}{error && <div className="split-error">{error}</div>}
          <div className="split-actions">{typeof window !== "undefined" && window.showDirectoryPicker && <button className="folder-button" disabled={busy || !!rangeError} onClick={() => void chooseFolder()}>폴더 선택 후 저장</button>}<button className="build-button" disabled={busy || !!rangeError} onClick={() => void build()}>{outputs.length ? "파일 다시 만들기" : "분할 파일 만들기"}</button></div>
        </section>
      </div>}
      {outputs.length > 0 && !busy && <section className="download-box"><div><small>저장 준비 완료</small><h2>{outputs.length}개 파일을 만들었습니다</h2><p>각 파일을 따로 저장하거나 한 번에 저장하세요.</p></div><button onClick={() => void downloadAll()}>전체 다운로드</button><div>{outputs.map((item) => <p key={item.name}><b>PDF</b><span>{item.name}</span><button onClick={() => download(item.blob, item.name)}>저장</button></p>)}</div></section>}
    </div>
  </section>;
}
