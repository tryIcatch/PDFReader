import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";

import type { FormulaItem, NoteItem, OpenDocumentResult } from "@shared/types";

import type { ReaderTextSelection } from "../types/reader";
import { documentService } from "../services/documentService";
import { renderMixedLatexContent } from "../utils/renderMixedLatex";
import { FormulaRender } from "./FormulaRender";
import { LatexMarkdown } from "./LatexMarkdown";

type AiPanelTab = "translation" | "formula" | "notes" | "export";

type AiPanelProps = {
  activeTab: AiPanelTab;
  onTabChange: (tab: AiPanelTab) => void;
  document: OpenDocumentResult | null;
  selectedTextSelection: ReaderTextSelection | null;
  translationPreview?: string;
  translationModel?: string;
  translationCached?: boolean;
  isTranslating?: boolean;
  isSavingTranslationNote?: boolean;
  isSavingSelectionFavorite?: boolean;
  formulas: FormulaItem[];
  notes: NoteItem[];
  formulaPreview?: FormulaItem | null;
  formulaPreviewImageUrl?: string;
  formulaFeedback?: string;
  isFormulaSelectionMode?: boolean;
  isRecognizingFormula?: boolean;
  isExplainingFormula?: boolean;
  isSavingFormulaNote?: boolean;
  activeNoteId?: string | null;
  onTranslateSelection?: () => void;
  onSaveTranslationNote?: () => void;
  onSaveSelectionFavorite?: () => void;
  onStartFormulaSelection?: () => void;
  onCancelFormulaSelection?: () => void;
  onOpenFormulaPreview?: (formula: FormulaItem) => void;
  onFormulaLatexChange?: (latex: string) => void;
  onOpenNote?: (note: NoteItem) => void;
  onExplainFormula?: () => void;
  onSaveFormulaNote?: () => void;
  onExportMarkdown?: () => void;
};

const TABS: Array<{ id: AiPanelTab; label: string }> = [
  { id: "translation", label: "翻译" },
  { id: "formula", label: "公式" },
  { id: "notes", label: "笔记" },
  { id: "export", label: "导出" },
];

export function AiPanel(props: AiPanelProps) {
  const currentFormula = props.formulaPreview;
  const [copied, setCopied] = useState(false);
  const [editableLatex, setEditableLatex] = useState("");

  useEffect(() => {
    setEditableLatex(currentFormula?.latex ?? "");
    setCopied(false);
  }, [currentFormula?.id, currentFormula?.latex]);

  async function handleCopyLatex() {
    const latex = editableLatex.trim();

    if (!latex) {
      return;
    }

    try {
      await navigator.clipboard.writeText(latex);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <aside className="ai-panel">
      <div className="ai-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={tab.id === props.activeTab ? "ai-tab ai-tab--active" : "ai-tab"}
            onClick={() => props.onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="ai-panel-body">
        {props.activeTab === "translation" ? (
          <section className="panel-card">
            <h3>当前翻译</h3>
            <div className="translation-section">
              <p className="translation-label">选中文本</p>
              <div className="preview-block preview-block--source">
                {props.selectedTextSelection?.selectedText || "先在 PDF 页面中选中一段文本。"}
              </div>
              {props.selectedTextSelection ? (
                <p className="translation-meta">页码：第 {props.selectedTextSelection.pageNumber} 页</p>
              ) : null}
            </div>

            <div className="translation-section">
              <p className="translation-label">译文</p>
              <div className="preview-block">
                {props.isTranslating
                  ? "正在翻译当前选区..."
                  : props.translationPreview || "选中文本后，这里会显示译文。"}
              </div>
              {props.translationModel ? (
                <p className="translation-meta">
                  模型：{props.translationModel}
                  {props.translationCached ? " · 命中缓存" : ""}
                </p>
              ) : null}
            </div>

            <div className="panel-actions">
              <button
                className="secondary"
                disabled={!props.selectedTextSelection || props.isTranslating}
                onClick={props.onTranslateSelection}
              >
                {props.isTranslating ? "翻译中..." : "重新翻译"}
              </button>
              <button
                disabled={
                  !props.selectedTextSelection || !props.translationPreview || props.isSavingTranslationNote
                }
                onClick={props.onSaveTranslationNote}
              >
                {props.isSavingTranslationNote ? "保存中..." : "保存到笔记"}
              </button>
              <button
                className="secondary"
                disabled={!props.selectedTextSelection || props.isSavingSelectionFavorite}
                onClick={props.onSaveSelectionFavorite}
              >
                {props.isSavingSelectionFavorite ? "收藏中..." : "收藏选区"}
              </button>
            </div>
          </section>
        ) : null}

        {props.activeTab === "formula" ? (
          <section className="panel-card">
            <div className="formula-panel-header">
              <div>
                <h3>公式工作区</h3>
                <p className="muted">框选公式后，先看渲染和解释，原始 LaTeX 与历史记录收纳到下面。</p>
              </div>
              <div className="formula-panel-header-actions">
                {props.isFormulaSelectionMode ? (
                  <button className="secondary" onClick={props.onCancelFormulaSelection}>
                    取消框选
                  </button>
                ) : (
                  <button onClick={props.onStartFormulaSelection}>开始框选</button>
                )}
              </div>
            </div>

            {props.formulaFeedback ? <div className="formula-feedback">{props.formulaFeedback}</div> : null}

            {currentFormula ? (
              <div className="formula-meta-row">
                <span className="formula-chip">第 {currentFormula.pageNumber} 页</span>
                <span className="formula-chip">{toOcrProviderLabel(currentFormula.ocrProvider)}</span>
                {currentFormula.confidence !== undefined ? (
                  <span className="formula-chip">
                    置信度 {Math.round(currentFormula.confidence * 100)}%
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="formula-preview-grid">
              <section className="formula-preview-panel">
                <p className="translation-label">截图</p>
                {props.formulaPreviewImageUrl ? (
                  <div className="formula-image-card">
                    <img
                      className="formula-image-preview"
                      src={props.formulaPreviewImageUrl}
                      alt="当前公式截图预览"
                    />
                  </div>
                ) : currentFormula?.imagePath ? (
                  <div className="formula-image-card">
                    <img
                      className="formula-image-preview"
                      src={toFileUrl(currentFormula.imagePath)}
                      alt={`第 ${currentFormula.pageNumber} 页公式截图`}
                    />
                  </div>
                ) : (
                  <div className="preview-block">框选完成后，这里会显示裁剪下来的公式截图。</div>
                )}
              </section>

              <section className="formula-preview-panel">
                <p className="translation-label">渲染结果</p>
                <FormulaRender latex={editableLatex || currentFormula?.latex} />
              </section>
            </div>

            <div className="translation-section">
              <div className="formula-latex-header">
                <p className="translation-label">LaTeX</p>
                <button
                  className="secondary formula-copy-button"
                  disabled={!editableLatex.trim()}
                  onClick={() => void handleCopyLatex()}
                >
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
              <textarea
                className="formula-latex-editor"
                value={editableLatex}
                onChange={(event) => {
                  setEditableLatex(event.target.value);
                  props.onFormulaLatexChange?.(event.target.value);
                }}
                placeholder="Formula LaTeX"
                spellCheck={false}
              />
            </div>

            <div className="translation-section">
              <p className="translation-label">中文解释</p>
              <div className="preview-block">
                {props.isExplainingFormula
                  ? "正在生成公式解释..."
                  : currentFormula?.explanation
                    ? <LatexMarkdown content={currentFormula.explanation} />
                    : "识别完成后，这里会显示公式含义与简化说明。"}
              </div>
            </div>

            {currentFormula?.variables?.length ? (
              <div className="translation-section">
                <p className="translation-label">变量说明</p>
                <ul className="formula-variable-list">
                  {currentFormula.variables.map((variable) => (
                    <li key={`${variable.symbol}:${variable.meaning}`}>
                      <strong className="formula-variable-symbol">
                        {renderMixedLatexContent(variable.symbol)}
                      </strong>
                      <span>{variable.meaning}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="panel-actions">
              <button
                className="secondary"
                disabled={!currentFormula?.latex || props.isRecognizingFormula || props.isExplainingFormula}
                onClick={props.onExplainFormula}
              >
                {props.isExplainingFormula ? "解释中..." : "重新解释"}
              </button>
              <button
                disabled={!currentFormula?.id || props.isSavingFormulaNote}
                onClick={props.onSaveFormulaNote}
              >
                {props.isSavingFormulaNote ? "收藏中..." : "收藏公式"}
              </button>
            </div>

            {props.formulas.length > 0 ? (
              <details className="formula-collapse">
                <summary>最近公式记录（{props.formulas.length}）</summary>
                <ul className="panel-list">
                  {props.formulas.slice(0, 6).map((formula) => (
                    <li key={formula.id}>
                      <button
                        className={
                          formula.id === currentFormula?.id
                            ? "panel-list-button panel-list-button--active"
                            : "panel-list-button"
                        }
                        onClick={() => props.onOpenFormulaPreview?.(formula)}
                      >
                        <strong>第 {formula.pageNumber} 页</strong>
                        <span>{formula.latex || "尚未识别出 LaTeX 结果"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        ) : null}

        {props.activeTab === "notes" ? (
          <section className="panel-card">
            <h3>文档笔记</h3>
            <div className="panel-metric">
              当前文档笔记数：<strong>{props.notes.filter((n) => n.noteType === "formula_favorite" || n.comment).length}</strong>
            </div>
            {props.notes.length > 0 ? (
              <ul className="panel-list">
                {props.notes
                  .filter((n) => n.noteType === "formula_favorite" || n.comment)
                  .slice(0, 8).map((note) => (
                  <li key={note.id}>
                    <button
                      className={
                        note.id === props.activeNoteId
                          ? "panel-list-button panel-list-button--active"
                          : "panel-list-button"
                      }
                      onClick={() => props.onOpenNote?.(note)}
                    >
                    <strong>
                      {toNoteTypeLabel(note.noteType)}
                      <span className="panel-list-page"> · p.{note.pageNumber}</span>
                    </strong>
                    {note.noteType === "formula_favorite" && note.selectedText ? (
                      <span className="panel-list-formula">
                        <FormulaRender latex={note.selectedText} />
                      </span>
                    ) : (
                      <span>{note.selectedText || note.comment || "公式收藏"}</span>
                    )}
                    </button>
                    {note.noteType === "formula_favorite" ? (
                      <FormulaNoteCopyButton
                        latex={note.selectedText ?? ""}
                        formulaId={note.formulaId}
                        formulas={props.formulas}
                      />
                    ) : (
                      <TextNoteCopyButton
                        text={note.selectedText || note.comment || ""}
                      />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">还没有笔记内容。</p>
            )}
          </section>
        ) : null}

        {props.activeTab === "export" ? (
          <section className="panel-card">
            <h3>Markdown 导出</h3>
            <p className="muted">导出能力已经接到主进程，后面再继续补字段勾选和导出预览。</p>
            <div className="panel-metric">
              {props.document ? `当前文档：${props.document.fileName}` : "请先打开文档。"}
            </div>
            <div className="panel-actions">
              <button
                className="secondary"
                disabled={!props.document}
                onClick={props.onExportMarkdown}
              >
                导出当前文档 Markdown
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

type FormulaNoteCopyButtonProps = {
  latex: string;
  formulaId?: string;
  formulas: FormulaItem[];
};

function FormulaNoteCopyButton(props: FormulaNoteCopyButtonProps) {
  const [open, setOpen] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleCopyLatex() {
    try {
      await navigator.clipboard.writeText(props.latex);
      setCopyFeedback("LaTeX 已复制");
    } catch {
      setCopyFeedback("复制失败");
    }

    window.setTimeout(() => setCopyFeedback(""), 1400);
    setOpen(false);
  }

  async function handleCopyImage() {
    const formula = props.formulas.find((formula) => formula.id === props.formulaId);

    if (!formula?.imagePath) {
      setCopyFeedback("未找到公式截图");
      window.setTimeout(() => setCopyFeedback(""), 1400);
      setOpen(false);
      return;
    }

    try {
      const binary = await documentService.readDocumentBinary({ filePath: formula.imagePath });
      const mimeType = guessImageMimeType(formula.imagePath);
      const blob = new Blob([binary], { type: mimeType });
      await navigator.clipboard.write([new ClipboardItem({ [mimeType]: blob })]);
      setCopyFeedback("图片已复制");
    } catch {
      setCopyFeedback("复制失败");
    }

    window.setTimeout(() => setCopyFeedback(""), 1400);
    setOpen(false);
  }

  return (
    <div className="formula-note-copy" ref={containerRef}>
      <button
        className="icon-button formula-note-copy-trigger"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        title="复制公式"
      >
        <Copy size={14} strokeWidth={2} />
      </button>
      {open ? (
        <div className="formula-note-copy-menu">
          <button onClick={() => void handleCopyLatex()}>复制 LaTeX</button>
          <button onClick={() => void handleCopyImage()}>复制图片</button>
        </div>
      ) : null}
      {copyFeedback ? (
        <span className="formula-note-copy-feedback">{copyFeedback}</span>
      ) : null}
    </div>
  );
}

function TextNoteCopyButton(props: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(props.text);
      setCopied(true);
    } catch {
      setCopied(false);
    }

    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="formula-note-copy">
      <button
        className="icon-button formula-note-copy-trigger"
        onClick={(event) => {
          event.stopPropagation();
          void handleCopy();
        }}
        title="复制文本"
      >
        <Copy size={14} strokeWidth={2} />
      </button>
      {copied ? (
        <span className="formula-note-copy-feedback">已复制</span>
      ) : null}
    </div>
  );
}

function toNoteTypeLabel(noteType: NoteItem["noteType"]): string {
  if (noteType === "highlight") {
    return "文本高亮";
  }

  if (noteType === "comment") {
    return "文本批注";
  }

  return "公式收藏";
}

function toOcrProviderLabel(provider: FormulaItem["ocrProvider"]): string {
  return provider === "pix2tex" ? "pix2tex 本地 OCR" : "Mathpix 云 OCR";
}

function toFileUrl(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const withPrefix = normalizedPath.startsWith("/")
    ? `file://${normalizedPath}`
    : `file:///${normalizedPath}`;

  return encodeURI(withPrefix);
}

function guessImageMimeType(filePath: string): string {
  const normalizedPath = filePath.toLowerCase();

  if (normalizedPath.endsWith(".jpg") || normalizedPath.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (normalizedPath.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/png";
}
