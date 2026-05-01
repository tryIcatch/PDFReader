import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";
import { Bot, PanelLeftOpen } from "lucide-react";

import type {
  AppMenuAction,
  FormulaItem,
  LibrarySnapshot,
  NoteItem,
  OpenDocumentResult,
  RecentDocumentItem,
} from "@shared/types";

import { AiPanel } from "../components/AiPanel";
import { LibraryHome } from "../components/LibraryHome";
import { PdfViewer } from "../components/PdfViewer";
import { SettingsModal } from "../components/SettingsModal";
import { Sidebar } from "../components/Sidebar";
import { documentService } from "../services/documentService";
import { exportService } from "../services/exportService";
import { formulaService } from "../services/formulaService";
import { libraryService } from "../services/libraryService";
import { noteService } from "../services/noteService";
import { settingsService } from "../services/settingsService";
import { translateService } from "../services/translateService";
import type {
  FormulaCaptureDraft,
  ReaderSearchResult,
  ReaderTextSelection,
} from "../types/reader";

type AiPanelTab = "translation" | "formula" | "notes" | "export";
type ReaderZoomMode = "fit-width" | "manual";
type WorkspaceMode = "booting" | "library" | "reader";

export function ReaderPage() {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("booting");
  const [recentDocuments, setRecentDocuments] = useState<RecentDocumentItem[]>([]);
  const [librarySnapshot, setLibrarySnapshot] = useState<LibrarySnapshot>({
    folders: [],
    documents: [],
  });
  const [selectedLibraryFolderId, setSelectedLibraryFolderId] = useState<string | null>(null);
  const [launchMessage, setLaunchMessage] = useState("");
  const [currentDocument, setCurrentDocument] = useState<OpenDocumentResult | null>(null);
  const [activeTab, setActiveTab] = useState<AiPanelTab>("translation");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ReaderSearchResult[]>([]);
  const [activeSearchResultIndex, setActiveSearchResultIndex] = useState(-1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [zoomMode, setZoomMode] = useState<ReaderZoomMode>("fit-width");
  const [displayZoom, setDisplayZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState("正在准备工作区");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoTranslateEnabled, setAutoTranslateEnabled] = useState(false);
  const [hoveredText, setHoveredText] = useState("");
  const [hoveredPosition, setHoveredPosition] = useState<{ x: number; y: number } | null>(null);
  const [hoveredTranslation, setHoveredTranslation] = useState("");
  const [isTranslatingHover, setIsTranslatingHover] = useState(false);
  const hoverGenerationRef = useRef(0);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [formulas, setFormulas] = useState<FormulaItem[]>([]);
  const [selectedTextSelection, setSelectedTextSelection] = useState<ReaderTextSelection | null>(
    null,
  );
  const [translationPreview, setTranslationPreview] = useState("");
  const [translationModel, setTranslationModel] = useState("");
  const [translationCached, setTranslationCached] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isSavingTranslationNote, setIsSavingTranslationNote] = useState(false);
  const [isSavingSelectionFavorite, setIsSavingSelectionFavorite] = useState(false);
  const [selectionMode, setSelectionMode] = useState<"text" | "formula">("text");
  const [formulaPreview, setFormulaPreview] = useState<FormulaItem | null>(null);
  const [formulaPreviewImageUrl, setFormulaPreviewImageUrl] = useState("");
  const [formulaFeedback, setFormulaFeedback] = useState("");
  const [isRecognizingFormula, setIsRecognizingFormula] = useState(false);
  const [isExplainingFormula, setIsExplainingFormula] = useState(false);
  const [isSavingFormulaNote, setIsSavingFormulaNote] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [documentGlanceVisible, setDocumentGlanceVisible] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const documentGlanceTimerRef = useRef<number | null>(null);
  const formulaPreviewObjectUrlRef = useRef<string | null>(null);

  const revealDocumentGlance = useEffectEvent(() => {
    if (workspaceMode !== "reader") {
      return;
    }

    setDocumentGlanceVisible(true);

    if (documentGlanceTimerRef.current !== null) {
      window.clearTimeout(documentGlanceTimerRef.current);
    }

    documentGlanceTimerRef.current = window.setTimeout(() => {
      setDocumentGlanceVisible(false);
      documentGlanceTimerRef.current = null;
    }, 1600);
  });

  async function loadRecentDocuments() {
    try {
      const items = await documentService.listRecentDocuments();
      startTransition(() => {
        setRecentDocuments(items);
      });
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "读取最近文档失败");
    }
  }

  async function loadLibrarySnapshot() {
    try {
      const snapshot = await libraryService.listSnapshot();
      startTransition(() => {
        setLibrarySnapshot(snapshot);
      });
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "读取论文仓库失败");
    }
  }

  function resetReaderTransientState() {
    setSearchQuery("");
    setSearchResults([]);
    setActiveSearchResultIndex(-1);
    setSearchOpen(false);
    setSelectionMode("text");
    setSelectedTextSelection(null);
    setActiveNoteId(null);
    setTranslationPreview("");
    setTranslationModel("");
    setTranslationCached(false);
    setFormulaPreview(null);
    setFormulaPreviewImageUrl("");
    setFormulaFeedback("");
    setSidebarOpen(false);
    setAiPanelOpen(false);
  }

  function applyOpenedDocument(document: OpenDocumentResult) {
    startTransition(() => {
      setWorkspaceMode("reader");
      setCurrentDocument(document);
      setCurrentPage(document.lastPage ?? 1);
      setZoom(1);
      setZoomMode("fit-width");
      setDisplayZoom(1);
      resetReaderTransientState();
    });
  }

  function openLibraryView(message?: string, preferredFolderId?: string | null) {
    startTransition(() => {
      setWorkspaceMode("library");
      setCurrentDocument(null);
      setSelectedLibraryFolderId(preferredFolderId ?? null);
      setLaunchMessage(message ?? "");
      setDocumentGlanceVisible(false);
      resetReaderTransientState();
    });
  }

  async function bootstrapWorkspace() {
    setStatus("正在恢复上次阅读...");

    try {
      const launchState = await documentService.getLaunchState();
      await Promise.all([loadRecentDocuments(), loadLibrarySnapshot()]);

      if (launchState.mode === "resume") {
        applyOpenedDocument(launchState.document);
        setStatus(`已恢复 ${launchState.document.fileName}`);
        return;
      }

      const message =
        launchState.reason === "missing_recent_document" && launchState.missingFileName
          ? `上次阅读的论文「${launchState.missingFileName}」找不到了，已回到论文仓库。`
          : launchState.reason === "first_launch"
            ? "欢迎使用论文仓库。先导入一篇论文，我们就能从这里开始整理和阅读。"
            : "没有可恢复的最近阅读记录，已打开论文仓库。";

      openLibraryView(message);
      setStatus("已进入论文仓库");
    } catch (cause) {
      await Promise.all([loadRecentDocuments(), loadLibrarySnapshot()]);
      openLibraryView("恢复上次阅读失败，已回到论文仓库。");
      setStatus(cause instanceof Error ? cause.message : "启动失败，已回到论文仓库");
    }
  }

  function openSearchPopover() {
    if (workspaceMode !== "reader") {
      return;
    }

    setSearchOpen(true);
  }

  function updateZoom(nextZoom: number) {
    const normalizedZoom = Math.round(nextZoom * 100) / 100;
    const safeZoom = Math.min(Math.max(normalizedZoom, 0.5), 4);
    setZoomMode("manual");
    setZoom(safeZoom);
  }

  function resetZoom() {
    setZoomMode("manual");
    setZoom(1);
    setDisplayZoom(1);
    setStatus("缩放已恢复到 100%");
  }

  function applyThemeColor(accentColor: string) {
    const normalizedColor = normalizeHexColor(accentColor) ?? "#7f4f24";
    const rgb = hexToRgb(normalizedColor);
    const surfaceRgb = mixRgb(rgb, { r: 255, g: 250, b: 244 }, 0.12);
    const surfaceSoftRgb = mixRgb(rgb, { r: 255, g: 250, b: 244 }, 0.2);
    const surfaceStrongRgb = mixRgb(rgb, { r: 255, g: 250, b: 244 }, 0.28);
    const backgroundStartRgb = mixRgb(rgb, { r: 248, g: 246, b: 242 }, 0.16);
    const backgroundEndRgb = mixRgb(rgb, { r: 255, g: 252, b: 247 }, 0.08);
    const textRgb = mixRgb(rgb, { r: 33, g: 27, b: 21 }, 0.22);
    const mutedRgb = mixRgb(rgb, { r: 92, g: 79, b: 66 }, 0.3);

    document.documentElement.style.setProperty("--accent", normalizedColor);
    document.documentElement.style.setProperty("--accent-rgb", `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    document.documentElement.style.setProperty("--surface-rgb", rgbCss(surfaceRgb));
    document.documentElement.style.setProperty("--surface-soft-rgb", rgbCss(surfaceSoftRgb));
    document.documentElement.style.setProperty("--surface-strong-rgb", rgbCss(surfaceStrongRgb));
    document.documentElement.style.setProperty("--app-bg-start", rgbCss(backgroundStartRgb));
    document.documentElement.style.setProperty("--app-bg-end", rgbCss(backgroundEndRgb));
    document.documentElement.style.setProperty("--text", rgbCss(textRgb));
    document.documentElement.style.setProperty("--muted", rgbCss(mutedRgb));
  }

  function handlePrevPage() {
    setCurrentPage((page) => Math.max(page - 1, 1));
    revealDocumentGlance();
  }

  function handleNextPage() {
    setCurrentPage((page) => Math.min(page + 1, pageCount || 1));
    revealDocumentGlance();
  }

  function handleBoundaryPageRequest(direction: "previous" | "next") {
    if (direction === "previous") {
      if (currentPage <= 1) {
        return;
      }

      handlePrevPage();
      return;
    }

    if (!pageCount || currentPage >= pageCount) {
      return;
    }

    handleNextPage();
  }

  async function openFileByPath(
    filePath: string,
    options?: {
      libraryFolderId?: string | null;
      successStatus?: string;
    },
  ) {
    try {
      const document = await documentService.openDocument({
        filePath,
        libraryFolderId: options?.libraryFolderId,
      });

      applyOpenedDocument(document);
      await Promise.all([loadRecentDocuments(), loadLibrarySnapshot()]);
      setStatus(options?.successStatus ?? `已打开 ${document.fileName}`);
      revealDocumentGlance();
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "打开 PDF 失败");
    }
  }

  async function handleOpenFile(folderId?: string | null) {
    try {
      setStatus("正在打开文件选择框...");
      const picked = await documentService.pickPdfFile();

      if (picked.canceled || !picked.filePath) {
        setStatus("已取消选择文件");
        return;
      }

      await openFileByPath(picked.filePath, {
        libraryFolderId: folderId,
      });
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "文件选择失败");
    }
  }

  async function loadDocumentArtifacts(documentId: string) {
    try {
      const [nextNotes, nextFormulas] = await Promise.all([
        noteService.listByDocument(documentId),
        formulaService.listByDocument(documentId),
      ]);
      const recentFormulas = sortFormulasByRecent(nextFormulas);
      const latestFormula = recentFormulas[0] ?? null;

      startTransition(() => {
        setNotes(nextNotes);
        setFormulas(recentFormulas);
        setFormulaPreview((previousPreview) => {
          if (previousPreview?.documentId === documentId) {
            return recentFormulas.find((item) => item.id === previousPreview.id) ?? latestFormula;
          }

          return latestFormula;
        });
      });
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "读取笔记和公式失败");
    }
  }

  async function handleCreateFolder(name: string, parentId: string | null) {
    try {
      const folder = await libraryService.createFolder({ name, parentId });
      await loadLibrarySnapshot();
      setSelectedLibraryFolderId(folder.id);
      setStatus(`已创建文件夹「${folder.name}」`);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "创建文件夹失败");
    }
  }

  async function handleRenameFolder(folderId: string, name: string) {
    try {
      const folder = await libraryService.renameFolder({ folderId, name });
      await loadLibrarySnapshot();
      setSelectedLibraryFolderId(folder.id);
      setStatus(`已重命名为「${folder.name}」`);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "重命名文件夹失败");
    }
  }

  async function handleMoveDocument(documentId: string, folderId: string | null) {
    try {
      await libraryService.moveDocumentToFolder({ documentId, folderId });
      await Promise.all([loadLibrarySnapshot(), loadRecentDocuments()]);
      setStatus(folderId ? "论文已移动到新的文件夹" : "论文已移回根层");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "移动论文失败");
    }
  }

  function handleOpenSearchResult(result: ReaderSearchResult, index: number) {
    setCurrentPage(result.pageNumber);
    setActiveSearchResultIndex(index);
    setSidebarOpen(true);
    setStatus(`已跳转到第 ${result.pageNumber} 页的搜索结果`);
    revealDocumentGlance();
  }

  function handleSearchResultsChange(nextResults: ReaderSearchResult[]) {
    startTransition(() => {
      setSearchResults(nextResults);
    });

    const normalizedQuery = searchQuery.trim();

    if (!normalizedQuery) {
      setActiveSearchResultIndex(-1);
      return;
    }

    setSidebarOpen(true);

    if (nextResults.length === 0) {
      setActiveSearchResultIndex(-1);
      setStatus(`没有找到与“${normalizedQuery}”匹配的文本`);
      return;
    }

    setActiveSearchResultIndex(0);
    setCurrentPage(nextResults[0].pageNumber);
    setStatus(`找到 ${nextResults.length} 条搜索结果，已定位到第一条`);
    revealDocumentGlance();
  }

  function handlePrevSearchResult() {
    if (searchResults.length === 0) {
      return;
    }

    const nextIndex =
      activeSearchResultIndex <= 0 ? searchResults.length - 1 : activeSearchResultIndex - 1;
    handleOpenSearchResult(searchResults[nextIndex], nextIndex);
  }

  function handleNextSearchResult() {
    if (searchResults.length === 0) {
      return;
    }

    const nextIndex =
      activeSearchResultIndex >= searchResults.length - 1 ? 0 : activeSearchResultIndex + 1;
    handleOpenSearchResult(searchResults[nextIndex], nextIndex);
  }

  async function handleExportMarkdown() {
    if (!currentDocument) {
      return;
    }

    try {
      const result = await exportService.exportMarkdown({
        documentId: currentDocument.documentId,
        includeOriginal: true,
        includeTranslation: true,
        includeLatex: true,
        includeExplanation: true,
      });

      setStatus(`Markdown 已导出到 ${result.outputPath}`);
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Markdown 导出失败");
    }
  }

  async function runSelectionTranslation(selection: ReaderTextSelection) {
    if (!currentDocument) {
      return;
    }

    setIsTranslating(true);
    setTranslationPreview("");
    setTranslationModel("");
    setTranslationCached(false);
    setStatus("正在翻译当前选区...");

    try {
      const result = await translateService.translateText({
        documentId: currentDocument.documentId,
        pageNumber: selection.pageNumber,
        text: selection.selectedText,
        targetLang: "zh-CN",
        context: selection.context,
      });

      setTranslationPreview(result.translatedText);
      setTranslationModel(result.model);
      setTranslationCached(result.cached);
      setStatus(result.cached ? "译文已返回（命中缓存）" : "译文已返回");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "翻译失败");
    } finally {
      setIsTranslating(false);
    }
  }

  async function handleSaveTranslationNote() {
    if (!currentDocument || !selectedTextSelection || !translationPreview) {
      return;
    }

    setIsSavingTranslationNote(true);

    try {
      const savedNote = await noteService.saveNote({
        documentId: currentDocument.documentId,
        pageNumber: selectedTextSelection.pageNumber,
        noteType: "highlight",
        selectedText: selectedTextSelection.selectedText,
        translatedText: translationPreview,
        color: "#FFE58F",
        anchorJson: selectedTextSelection.anchorJson,
        rectsJson: selectedTextSelection.rectsJson,
      });

      setActiveNoteId(savedNote.noteId);
      await loadDocumentArtifacts(currentDocument.documentId);
      setActiveTab("notes");
      setAiPanelOpen(true);
      setStatus("译文已保存到笔记");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "保存译文笔记失败");
    } finally {
      setIsSavingTranslationNote(false);
    }
  }

  async function handleSaveSelectionFavorite() {
    if (!currentDocument || !selectedTextSelection) {
      return;
    }

    setIsSavingSelectionFavorite(true);

    try {
      const savedNote = await noteService.saveNote({
        documentId: currentDocument.documentId,
        pageNumber: selectedTextSelection.pageNumber,
        noteType: "highlight",
        selectedText: selectedTextSelection.selectedText,
        comment: "收藏选区",
        color: "#BDE7FF",
        anchorJson: selectedTextSelection.anchorJson,
        rectsJson: selectedTextSelection.rectsJson,
      });

      setActiveNoteId(savedNote.noteId);
      await loadDocumentArtifacts(currentDocument.documentId);
      setActiveTab("notes");
      setAiPanelOpen(true);
      setStatus("选区已收藏并高亮显示");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "收藏选区失败");
    } finally {
      setIsSavingSelectionFavorite(false);
    }
  }

  const handleHoverText = useEffectEvent(async (text: string, position: { x: number; y: number }) => {
    if (!currentDocument || !autoTranslateEnabled) {
      return;
    }

    hoverGenerationRef.current += 1;
    const generation = hoverGenerationRef.current;

    setHoveredText(text);
    setHoveredPosition(position);
    setHoveredTranslation("");
    setIsTranslatingHover(true);

    try {
      const result = await translateService.translateText({
        documentId: currentDocument.documentId,
        pageNumber: currentPage,
        text,
        targetLang: "zh-CN",
      });

      if (hoverGenerationRef.current !== generation) {
        return;
      }

      setHoveredTranslation(result.translatedText);
    } catch {
      if (hoverGenerationRef.current !== generation) {
        return;
      }

      setHoveredTranslation("");
    } finally {
      if (hoverGenerationRef.current === generation) {
        setIsTranslatingHover(false);
      }
    }
  });

  const handleHoverLeave = useEffectEvent(() => {
    hoverGenerationRef.current += 1;
    setHoveredText("");
    setHoveredPosition(null);
    setHoveredTranslation("");
    setIsTranslatingHover(false);
  });

  function handleStartFormulaSelection() {
    if (!currentDocument) {
      setActiveTab("formula");
      setAiPanelOpen(true);
      setStatus("请先打开 PDF，再开始框选公式");
      return;
    }

    startTransition(() => {
      setSelectionMode("formula");
      setActiveTab("formula");
    });
    setAiPanelOpen(true);
    setFormulaFeedback("公式框选模式已开启，请在 PDF 页面中拖拽选中公式区域。");
    setStatus("公式框选模式已开启");
  }

  function handleCancelFormulaSelection() {
    setSelectionMode("text");
    setFormulaFeedback("已退出公式框选模式。");
    setStatus("已退出公式框选模式");
  }

  async function refreshFormulaPreview(formulaId: string) {
    const nextFormula = await formulaService.getById(formulaId);

    startTransition(() => {
      setFormulaPreview(nextFormula);
    });

    return nextFormula;
  }

  async function runFormulaExplanation(formula: FormulaItem) {
    if (!formula.latex) {
      setFormulaFeedback("当前公式还没有可解释的 LaTeX 结果。");
      setStatus("当前公式还没有可解释的 LaTeX 结果");
      return;
    }

    setIsExplainingFormula(true);
    setActiveTab("formula");
    setAiPanelOpen(true);
    setFormulaFeedback("正在生成公式解释...");
    setStatus("正在生成公式解释...");

    try {
      await formulaService.explainFormula({
        formulaId: formula.id,
        latex: formula.latex,
        context: formula.sourceContext,
      });

      const refreshedFormula = await refreshFormulaPreview(formula.id);
      await loadDocumentArtifacts(formula.documentId);
      setFormulaFeedback(refreshedFormula?.explanation ? "公式解释已生成。" : "公式解释已刷新。");
      setStatus(refreshedFormula?.explanation ? "公式解释已生成" : "公式解释已刷新");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "公式解释失败";
      setFormulaFeedback(message);
      setStatus(message);
    } finally {
      setIsExplainingFormula(false);
    }
  }

  async function handleFormulaAreaCapture(capture: FormulaCaptureDraft) {
    if (!currentDocument) {
      return;
    }

    const documentId = currentDocument.documentId;
    let preview: FormulaItem | null = null;

    setSelectionMode("text");
    setActiveTab("formula");
    setAiPanelOpen(true);
    setIsRecognizingFormula(true);
    setFormulaPreview(null);
    setFormulaPreviewImageUrl(capture.imageDataUrl);
    setFormulaFeedback(`已截取第 ${capture.pageNumber} 页公式区域，正在发送识别...`);
    setStatus(`已截取第 ${capture.pageNumber} 页公式区域，正在发送识别...`);

    try {
      const savedImage = await formulaService.saveFormulaImage({
        documentId,
        pageNumber: capture.pageNumber,
        imageDataUrl: capture.imageDataUrl,
      });

      const recognition = await formulaService.recognizeFormula({
        documentId,
        pageNumber: capture.pageNumber,
        bbox: capture.bbox,
        imagePath: savedImage.imagePath,
        sourceContext: capture.sourceContext,
      });

      preview = (await refreshFormulaPreview(recognition.formulaId)) ?? {
        id: recognition.formulaId,
        documentId,
        pageNumber: capture.pageNumber,
        bbox: capture.bbox,
        imagePath: savedImage.imagePath,
        latex: recognition.latex,
        confidence: recognition.confidence,
        ocrProvider: recognition.ocrProvider,
        sourceContext: capture.sourceContext,
        createdAt: new Date().toISOString(),
      };

      startTransition(() => {
        setFormulaPreview(preview);
      });

      await loadDocumentArtifacts(documentId);
      setFormulaFeedback("公式识别完成，正在继续生成解释...");
      setStatus("公式识别完成");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "公式识别失败";
      setFormulaFeedback(message);
      setStatus(message);
    } finally {
      setIsRecognizingFormula(false);
    }

    if (preview?.latex) {
      await runFormulaExplanation(preview);
    }
  }

  async function handleSaveFormulaNote() {
    if (!currentDocument || !formulaPreview?.id) {
      return;
    }

    setIsSavingFormulaNote(true);

    try {
      const savedNote = await noteService.saveNote({
        documentId: currentDocument.documentId,
        pageNumber: formulaPreview.pageNumber,
        noteType: "formula_favorite",
        selectedText: formulaPreview.latex,
        comment: formulaPreview.explanation,
        color: "#FFD591",
        formulaId: formulaPreview.id,
      });

      setActiveNoteId(savedNote.noteId);
      await loadDocumentArtifacts(currentDocument.documentId);
      setActiveTab("notes");
      setAiPanelOpen(true);
      setFormulaFeedback("公式已收藏到笔记。");
      setStatus("公式已收藏到笔记");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "收藏公式失败";
      setFormulaFeedback(message);
      setStatus(message);
    } finally {
      setIsSavingFormulaNote(false);
    }
  }

  function handleOpenFormulaPreview(formula: FormulaItem) {
    startTransition(() => {
      setFormulaPreview(formula);
      setFormulaPreviewImageUrl("");
      setActiveTab("formula");
    });
    setAiPanelOpen(true);
    setFormulaFeedback(`已加载第 ${formula.pageNumber} 页的公式记录。`);
    setStatus(`已加载第 ${formula.pageNumber} 页的公式记录`);
  }

  function handleOpenNote(note: NoteItem) {
    startTransition(() => {
      setActiveNoteId(note.id);
      setCurrentPage(note.pageNumber);
      setAiPanelOpen(true);

      if (note.noteType === "formula_favorite" && note.formulaId) {
        const matchedFormula = formulas.find((formula) => formula.id === note.formulaId);

        if (matchedFormula) {
          setFormulaPreview(matchedFormula);
          setFormulaPreviewImageUrl("");
          setActiveTab("formula");
          return;
        }
      }

      setActiveTab("notes");
    });

    revealDocumentGlance();
    setStatus(`已定位到第 ${note.pageNumber} 页的笔记`);
  }

  function handleFormulaLatexChange(latex: string) {
    setFormulaPreview((previousFormula) =>
      previousFormula
        ? {
            ...previousFormula,
            latex,
          }
        : previousFormula,
    );
  }

  const handleAppMenuAction = useEffectEvent((action: AppMenuAction) => {
    switch (action) {
      case "open_library":
        openLibraryView(undefined, currentDocument?.libraryFolderId ?? selectedLibraryFolderId);
        void Promise.all([loadRecentDocuments(), loadLibrarySnapshot()]);
        setStatus("已回到论文仓库");
        break;
      case "open_file":
        void handleOpenFile(workspaceMode === "library" ? selectedLibraryFolderId : undefined);
        break;
      case "open_settings":
        setSettingsOpen(true);
        break;
      case "toggle_search":
        if (workspaceMode === "reader") {
          setSearchOpen((open) => !open);
        }
        break;
      case "toggle_sidebar":
        if (workspaceMode === "reader") {
          setSidebarOpen((open) => !open);
        }
        break;
      case "toggle_ai_panel":
        if (workspaceMode === "reader") {
          setAiPanelOpen((open) => !open);
        }
        break;
      case "reset_zoom":
        if (workspaceMode === "reader") {
          resetZoom();
        }
        break;
      case "previous_page":
        if (workspaceMode === "reader") {
          handlePrevPage();
        }
        break;
      case "next_page":
        if (workspaceMode === "reader") {
          handleNextPage();
        }
        break;
    }
  });

  useEffect(() => {
    void bootstrapWorkspace();
  }, []);

  useEffect(() => {
    let canceled = false;

    async function loadSettings() {
      try {
        const [themeSettings, autoTranslateSettings] = await Promise.all([
          settingsService.getThemeSettings(),
          settingsService.getAutoTranslateSettings(),
        ]);

        if (!canceled) {
          applyThemeColor(themeSettings.accentColor);
          setAutoTranslateEnabled(autoTranslateSettings.enabled);
        }
      } catch {
        if (!canceled) {
          applyThemeColor("#7f4f24");
        }
      }
    }

    void loadSettings();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.pdfReader.onAppMenuAction((action) => {
      handleAppMenuAction(action);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!currentDocument || pageCount === 0) {
      return;
    }

    void documentService.updateReadingProgress({
      documentId: currentDocument.documentId,
      lastPage: currentPage,
      lastZoom: zoom,
    });
  }, [currentDocument, currentPage, pageCount, zoom]);

  useEffect(() => {
    if (!currentDocument) {
      startTransition(() => {
        setNotes([]);
        setFormulas([]);
        setFormulaPreview(null);
        setFormulaPreviewImageUrl("");
        setFormulaFeedback("");
        setSearchResults([]);
        setActiveSearchResultIndex(-1);
        setActiveNoteId(null);
        setDocumentGlanceVisible(false);
      });
      return;
    }

    void loadDocumentArtifacts(currentDocument.documentId);
  }, [currentDocument]);

  useEffect(() => {
    startTransition(() => {
      setSelectedTextSelection(null);
      setTranslationPreview("");
      setTranslationModel("");
      setTranslationCached(false);
      setSelectionMode("text");
      setFormulaFeedback("");
      hoverGenerationRef.current += 1;
      setHoveredText("");
      setHoveredPosition(null);
      setHoveredTranslation("");
      setIsTranslatingHover(false);
    });

    revealDocumentGlance();
  }, [currentDocument?.documentId, currentPage]);

  useEffect(() => {
    if (!selectedTextSelection || !currentDocument) {
      return;
    }

    if (autoTranslateEnabled) {
      hoverGenerationRef.current += 1;
      setHoveredText("");
      setHoveredPosition(null);
      setHoveredTranslation("");
      setIsTranslatingHover(false);
      void runSelectionTranslation(selectedTextSelection);
      return;
    }

    setActiveTab("translation");
    setAiPanelOpen(true);
    void runSelectionTranslation(selectedTextSelection);
  }, [currentDocument, selectedTextSelection?.signature, autoTranslateEnabled]);

  useEffect(() => {
    const imagePath = formulaPreview?.imagePath;

    if (!imagePath) {
      if (formulaPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(formulaPreviewObjectUrlRef.current);
        formulaPreviewObjectUrlRef.current = null;
      }
      return;
    }

    if (formulaPreviewImageUrl.startsWith("data:")) {
      return;
    }

    let canceled = false;
    const resolvedImagePath = imagePath;

    async function loadFormulaPreviewImage() {
      try {
        const binary = await documentService.readDocumentBinary({ filePath: resolvedImagePath });

        if (canceled) {
          return;
        }

        if (formulaPreviewObjectUrlRef.current) {
          URL.revokeObjectURL(formulaPreviewObjectUrlRef.current);
          formulaPreviewObjectUrlRef.current = null;
        }

        const blob = new Blob([binary], { type: guessImageMimeType(resolvedImagePath) });
        const objectUrl = URL.createObjectURL(blob);
        formulaPreviewObjectUrlRef.current = objectUrl;
        setFormulaPreviewImageUrl(objectUrl);
      } catch (cause) {
        if (!canceled) {
          setStatus(cause instanceof Error ? cause.message : "读取公式截图失败");
        }
      }
    }

    void loadFormulaPreviewImage();

    return () => {
      canceled = true;
    };
  }, [formulaPreview?.id, formulaPreview?.imagePath]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        if (workspaceMode !== "reader") {
          return;
        }

        event.preventDefault();
        openSearchPopover();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "0") {
        if (workspaceMode !== "reader") {
          return;
        }

        event.preventDefault();
        resetZoom();
        return;
      }

      if (event.key === "Escape" && searchOpen) {
        setSearchOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [searchOpen, workspaceMode]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }

    window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
  }, [searchOpen]);

  useEffect(() => {
    return () => {
      if (documentGlanceTimerRef.current !== null) {
        window.clearTimeout(documentGlanceTimerRef.current);
      }

      if (formulaPreviewObjectUrlRef.current) {
        URL.revokeObjectURL(formulaPreviewObjectUrlRef.current);
        formulaPreviewObjectUrlRef.current = null;
      }
    };
  }, []);

  const isReaderMode = workspaceMode === "reader";
  const recentResumeDocument = recentDocuments[0] ?? null;

  return (
    <div className="reader-layout">
      <div className="reader-main">
        {isReaderMode ? (
          <>
            <button
              className={
                sidebarOpen
                  ? "secondary edge-toggle edge-toggle--left edge-toggle--active"
                  : "secondary edge-toggle edge-toggle--left"
              }
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label="目录"
              title="目录"
            >
              <PanelLeftOpen size={18} strokeWidth={2.2} />
              目录
            </button>

            <button
              className={
                aiPanelOpen
                  ? "secondary edge-toggle edge-toggle--right edge-toggle--active"
                  : "secondary edge-toggle edge-toggle--right"
              }
              onClick={() => setAiPanelOpen((open) => !open)}
              aria-label="AI 面板"
              title="AI 面板"
            >
              <Bot size={18} strokeWidth={2.2} />
              AI
            </button>

            {searchOpen ? (
              <div className="search-popover">
                <div className="search-popover-row">
                  <input
                    ref={searchInputRef}
                    className="search-popover-input"
                    placeholder="搜索当前 PDF（Ctrl+F）"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                  <button className="secondary search-popover-close" onClick={() => setSearchOpen(false)}>
                    关闭
                  </button>
                </div>
                <div className="search-popover-row search-popover-row--meta">
                  <div className="search-popover-count">
                    {searchQuery
                      ? searchResultsCountLabel(activeSearchResultIndex, searchResults.length)
                      : "未搜索"}
                  </div>
                  <div className="search-popover-actions">
                    <button
                      className="secondary"
                      disabled={!searchResults.length}
                      onClick={handlePrevSearchResult}
                    >
                      上一个
                    </button>
                    <button
                      className="secondary"
                      disabled={!searchResults.length}
                      onClick={handleNextSearchResult}
                    >
                      下一个
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {currentDocument ? (
              <div
                className={
                  sidebarOpen
                    ? documentGlanceVisible
                      ? "document-glance document-glance--visible document-glance--shifted"
                      : "document-glance document-glance--shifted"
                    : documentGlanceVisible
                      ? "document-glance document-glance--visible"
                      : "document-glance"
                }
                title={currentDocument.fileName}
              >
                {currentDocument.fileName}
              </div>
            ) : null}

            {sidebarOpen ? (
              <div className="reader-overlay reader-overlay--sidebar">
                <Sidebar
                  recentDocuments={recentDocuments}
                  searchQuery={searchQuery}
                  searchResults={searchResults}
                  activeSearchIndex={activeSearchResultIndex}
                  onOpenRecent={(item) => void openFileByPath(item.filePath)}
                  onOpenSearchResult={handleOpenSearchResult}
                />
              </div>
            ) : null}

            <PdfViewer
              document={currentDocument}
              pageNumber={currentPage}
              zoom={zoom}
              zoomMode={zoomMode}
              searchQuery={searchQuery}
              selectionMode={selectionMode}
              notes={notes}
              formulas={formulas}
              activeNoteId={activeNoteId}
              onPageCountChange={setPageCount}
              onRenderedScaleChange={setDisplayZoom}
              onStatusChange={setStatus}
              onSearchResultsChange={handleSearchResultsChange}
              onZoomRequest={updateZoom}
              onViewerActivity={() => revealDocumentGlance()}
              onBoundaryPageRequest={handleBoundaryPageRequest}
              onFormulaAreaCapture={(capture) => {
                void handleFormulaAreaCapture(capture);
              }}
              onHoverText={(text, position) => {
                void handleHoverText(text, position);
              }}
              onHoverLeave={() => {
                handleHoverLeave();
              }}
              autoTranslateEnabled={autoTranslateEnabled}
              hoveredTranslation={hoveredTranslation}
              isTranslatingHover={isTranslatingHover}
              onTextSelectionChange={(selection) => {
                startTransition(() => {
                  setSelectedTextSelection(selection);

                  if (selection) {
                    setActiveTab("translation");
                  }
                });
              }}
            />

            {hoveredPosition && (hoveredTranslation || isTranslatingHover) ? (
              <div
                className="hover-translate-tooltip"
                style={{
                  left: `${hoveredPosition.x + 12}px`,
                  top: `${hoveredPosition.y + 18}px`,
                }}
              >
                <div className="hover-translate-tooltip-original">{hoveredText}</div>
                {isTranslatingHover ? (
                  <div className="hover-translate-tooltip-loading">翻译中…</div>
                ) : hoveredTranslation ? (
                  <div className="hover-translate-tooltip-result">{hoveredTranslation}</div>
                ) : null}
              </div>
            ) : null}

            {aiPanelOpen ? (
              <div className="reader-overlay reader-overlay--ai">
                <AiPanel
                  activeTab={activeTab}
                  onTabChange={(tab) => {
                    setActiveTab(tab);
                    setAiPanelOpen(true);
                  }}
                  document={currentDocument}
                  selectedTextSelection={selectedTextSelection}
                  translationPreview={translationPreview}
                  translationModel={translationModel}
                  translationCached={translationCached}
                  isTranslating={isTranslating}
                  isSavingTranslationNote={isSavingTranslationNote}
                  isSavingSelectionFavorite={isSavingSelectionFavorite}
                  formulas={formulas}
                  notes={notes}
                  formulaPreview={formulaPreview}
                  formulaPreviewImageUrl={formulaPreviewImageUrl}
                  formulaFeedback={formulaFeedback}
                  isFormulaSelectionMode={selectionMode === "formula"}
                  isRecognizingFormula={isRecognizingFormula}
                  isExplainingFormula={isExplainingFormula}
                  isSavingFormulaNote={isSavingFormulaNote}
                  activeNoteId={activeNoteId}
                  onTranslateSelection={() => {
                    if (selectedTextSelection) {
                      void runSelectionTranslation(selectedTextSelection);
                    }
                  }}
                  onSaveTranslationNote={() => void handleSaveTranslationNote()}
                  onSaveSelectionFavorite={() => void handleSaveSelectionFavorite()}
                  onStartFormulaSelection={handleStartFormulaSelection}
                  onCancelFormulaSelection={handleCancelFormulaSelection}
                  onExplainFormula={() => {
                    if (formulaPreview) {
                      void runFormulaExplanation(formulaPreview);
                    }
                  }}
                  onSaveFormulaNote={() => void handleSaveFormulaNote()}
                  onOpenFormulaPreview={handleOpenFormulaPreview}
                  onFormulaLatexChange={handleFormulaLatexChange}
                  onOpenNote={handleOpenNote}
                  onExportMarkdown={() => void handleExportMarkdown()}
                />
              </div>
            ) : null}
          </>
        ) : workspaceMode === "booting" ? (
          <section className="viewer viewer--empty">
            <div className="viewer-empty-card">
              <p className="eyebrow">Loading</p>
              <h2>正在恢复你的阅读工作区</h2>
              <p className="muted">如果上次阅读的论文仍然存在，我们会直接把你带回上次的位置。</p>
            </div>
          </section>
        ) : (
          <LibraryHome
            snapshot={librarySnapshot}
            recentDocuments={recentDocuments}
            selectedFolderId={selectedLibraryFolderId}
            launchMessage={launchMessage}
            onSelectFolder={setSelectedLibraryFolderId}
            onCreateFolder={(name, parentId) => {
              void handleCreateFolder(name, parentId);
            }}
            onRenameFolder={(folderId, name) => {
              void handleRenameFolder(folderId, name);
            }}
            onImportIntoCurrentFolder={() => {
              void handleOpenFile(selectedLibraryFolderId);
            }}
            onOpenDocument={(document) => {
              void openFileByPath(document.filePath);
            }}
            onOpenRecent={(document) => {
              void openFileByPath(document.filePath);
            }}
            onMoveDocument={(documentId, folderId) => {
              void handleMoveDocument(documentId, folderId);
            }}
          />
        )}
      </div>

      <footer className="status-bar">
        <div className="status-bar-group status-bar-group--left">
          <button
            className="secondary status-bar-button"
            onClick={() => {
              openLibraryView(undefined, currentDocument?.libraryFolderId ?? selectedLibraryFolderId);
              void Promise.all([loadRecentDocuments(), loadLibrarySnapshot()]);
            }}
          >
            论文仓库
          </button>

          {isReaderMode ? (
            <>
              <button
                className="secondary status-bar-button"
                disabled={currentPage <= 1 || !pageCount}
                onClick={handlePrevPage}
              >
                上一页
              </button>
              <button
                className="secondary status-bar-button"
                disabled={currentPage >= pageCount || !pageCount}
                onClick={handleNextPage}
              >
                下一页
              </button>
            </>
          ) : recentResumeDocument ? (
            <button
              className="secondary status-bar-button"
              onClick={() => {
                void openFileByPath(recentResumeDocument.filePath);
              }}
            >
              继续上次阅读
            </button>
          ) : null}
        </div>

        <div className="status-bar-group status-bar-group--center">
          <span className="status-bar-text">{status}</span>
        </div>

        <div className="status-bar-group status-bar-group--right">
          <span className="status-bar-chip">
            {isReaderMode && currentDocument ? `${currentPage}/${pageCount || 0}` : "论文仓库"}
          </span>
          {isReaderMode ? (
            <button
              className="secondary status-bar-button"
              onClick={resetZoom}
              title={
                zoomMode === "fit-width"
                  ? `当前为适应宽度（约 ${Math.round(displayZoom * 100)}%），点击恢复 100%`
                  : "恢复 100% 缩放"
              }
            >
              {zoomMode === "fit-width" ? "适宽" : `${Math.round(displayZoom * 100)}%`}
            </button>
          ) : null}
        </div>
      </footer>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onStatusChange={setStatus}
        onThemeChange={applyThemeColor}
        onAutoTranslateChange={setAutoTranslateEnabled}
      />
    </div>
  );
}

function searchResultsCountLabel(activeIndex: number, total: number): string {
  if (total === 0) {
    return "0 / 0";
  }

  return `${Math.max(activeIndex, 0) + 1} / ${total}`;
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

function sortFormulasByRecent(formulas: FormulaItem[]): FormulaItem[] {
  return [...formulas].sort((left, right) => getFormulaCreatedTime(right) - getFormulaCreatedTime(left));
}

function getFormulaCreatedTime(formula: FormulaItem): number {
  const timestamp = Date.parse(formula.createdAt || formula.updatedAt || "");

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function normalizeHexColor(value: string): string | null {
  const trimmedValue = value.trim();
  const expandedValue = /^#[0-9a-fA-F]{3}$/.test(trimmedValue)
    ? `#${trimmedValue[1]}${trimmedValue[1]}${trimmedValue[2]}${trimmedValue[2]}${trimmedValue[3]}${trimmedValue[3]}`
    : trimmedValue;

  return /^#[0-9a-fA-F]{6}$/.test(expandedValue) ? expandedValue.toLowerCase() : null;
}

function hexToRgb(hexColor: string): { r: number; g: number; b: number } {
  const normalizedColor = normalizeHexColor(hexColor) ?? "#7f4f24";

  return {
    r: Number.parseInt(normalizedColor.slice(1, 3), 16),
    g: Number.parseInt(normalizedColor.slice(3, 5), 16),
    b: Number.parseInt(normalizedColor.slice(5, 7), 16),
  };
}

function mixRgb(
  foreground: { r: number; g: number; b: number },
  background: { r: number; g: number; b: number },
  amount: number,
): { r: number; g: number; b: number } {
  const safeAmount = Math.min(Math.max(amount, 0), 1);

  return {
    r: Math.round(foreground.r * safeAmount + background.r * (1 - safeAmount)),
    g: Math.round(foreground.g * safeAmount + background.g * (1 - safeAmount)),
    b: Math.round(foreground.b * safeAmount + background.b * (1 - safeAmount)),
  };
}

function rgbCss(rgb: { r: number; g: number; b: number }): string {
  return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
}
