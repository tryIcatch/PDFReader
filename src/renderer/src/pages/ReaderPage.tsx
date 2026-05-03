import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";
import { PanelRightOpen } from "lucide-react";

import type {
  AppMenuAction,
  FormulaItem,
  LibrarySnapshot,
  NoteItem,
  OpenDocumentResult,
  RecentDocumentItem,
} from "@shared/types";

import { AiPanel } from "../components/AiPanel";
import { HoverTranslation } from "../components/HoverTranslation";
import { LibraryHome } from "../components/LibraryHome";
import { PdfViewer } from "../components/PdfViewer";
import { SettingsModal } from "../components/SettingsModal";
import { documentService } from "../services/documentService";
import { exportService } from "../services/exportService";
import { formulaService } from "../services/formulaService";
import { libraryService } from "../services/libraryService";
import { noteService } from "../services/noteService";
import { settingsService } from "../services/settingsService";
import { translateService } from "../services/translateService";
import { detectAndProtectFormulas, restoreFormulas } from "../utils/formulaProtector";
import type {
  FormulaCaptureDraft,
  ReaderSearchResult,
  ReaderTextSelection,
} from "../types/reader";

type AiPanelTab = "translation" | "formula" | "notes" | "export";
type ReaderZoomMode = "fit-width" | "manual" | "custom";
type WorkspaceMode = "booting" | "library" | "reader";

export function ReaderPage() {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("booting");
  const [focusMode, setFocusMode] = useState(false);
  const [focusColumnMode, setFocusColumnMode] = useState<"single" | "double">("single");
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
  const [displayZoom, setDisplayZoom] = useState(1);
  const [resetZoomVersion, setResetZoomVersion] = useState(0);
  const [zoomMode, setZoomMode] = useState<ReaderZoomMode>("fit-width");
  const [targetPage, setTargetPage] = useState(1);
  const [displayPage, setDisplayPage] = useState(1);
  const pageNavigationRef = useRef({ lastTarget: 1, updatedAt: 0 });
  const [pageCount, setPageCount] = useState(0);
  const [status, setStatus] = useState("正在准备工作区");
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [hoverTranslateEnabled, setHoverTranslateEnabled] = useState(false);
  const [hoverTranslationVisible, setHoverTranslationVisible] = useState(false);
  const [highlightColor, setHighlightColor] = useState("#FFE58F");
  const [isSelectionHighlighted, setIsSelectionHighlighted] = useState(false);
  const [isSelectionFavorited, setIsSelectionFavorited] = useState(false);
  const [documentGlanceVisible, setDocumentGlanceVisible] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const documentGlanceTimerRef = useRef<number | null>(null);
  const documentGlanceDebounceRef = useRef<number | null>(null);
  const formulaPreviewObjectUrlRef = useRef<string | null>(null);

  const revealDocumentGlance = useEffectEvent(() => {
    if (workspaceMode !== "reader") {
      return;
    }

    if (documentGlanceDebounceRef.current !== null) {
      window.clearTimeout(documentGlanceDebounceRef.current);
    }

    if (documentGlanceVisible) {
      if (documentGlanceTimerRef.current !== null) {
        window.clearTimeout(documentGlanceTimerRef.current);
      }

      documentGlanceTimerRef.current = window.setTimeout(() => {
        setDocumentGlanceVisible(false);
        documentGlanceTimerRef.current = null;
      }, 1500);

      return;
    }

    documentGlanceDebounceRef.current = window.setTimeout(() => {
      documentGlanceDebounceRef.current = null;
      setDocumentGlanceVisible(true);

      if (documentGlanceTimerRef.current !== null) {
        window.clearTimeout(documentGlanceTimerRef.current);
      }

      documentGlanceTimerRef.current = window.setTimeout(() => {
        setDocumentGlanceVisible(false);
        documentGlanceTimerRef.current = null;
      }, 1500);
    }, 180);
  });

  function syncRecentDocumentsToMenu(items: RecentDocumentItem[]) {
    window.pdfReader.updateRecentDocumentsMenu(
      items.map((item) => ({
        fileName: item.fileName,
        filePath: item.filePath,
      })),
    );
  }

  async function loadRecentDocuments() {
    try {
      const items = await documentService.listRecentDocuments();
      startTransition(() => {
        setRecentDocuments(items);
      });
      syncRecentDocumentsToMenu(items);
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
    setAiPanelOpen(false);
  }

  function applyOpenedDocument(document: OpenDocumentResult) {
    startTransition(() => {
      setWorkspaceMode("reader");
      setCurrentDocument(document);
      setTargetPage(document.lastPage ?? 1);
      setDisplayPage(document.lastPage ?? 1);
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
    setDisplayZoom(nextZoom);
    setZoomMode("custom");
  }

  function resetZoom() {
    setZoomMode("manual");
    setResetZoomVersion((v) => v + 1);
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

  function getNavigationBasePage() {
    const lastNavigation = pageNavigationRef.current;
    return performance.now() - lastNavigation.updatedAt < 700 ? lastNavigation.lastTarget : displayPage;
  }

  function navigateToPage(page: number) {
    const nextPage = Math.min(Math.max(page, 1), pageCount || 1);
    pageNavigationRef.current = { lastTarget: nextPage, updatedAt: performance.now() };
    setTargetPage(nextPage);
    setDisplayPage(nextPage);
    revealDocumentGlance();
  }

  function handlePrevPage() {
    navigateToPage(getNavigationBasePage() - 1);
  }

  function handleNextPage() {
    navigateToPage(getNavigationBasePage() + 1);
  }

  function handleDisplayPageChange(page: number) {
    setDisplayPage(page);
    if (page === pageNavigationRef.current.lastTarget) {
      pageNavigationRef.current.updatedAt = 0;
    }
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
    setTargetPage(result.pageNumber);
    setActiveSearchResultIndex(index);
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

    if (nextResults.length === 0) {
      setActiveSearchResultIndex(-1);
      setStatus(`没有找到与“${normalizedQuery}”匹配的文本`);
      return;
    }

    setActiveSearchResultIndex(0);
    setTargetPage(nextResults[0].pageNumber);
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
      const textToTranslate = selection.selectedText;
      const protection = detectAndProtectFormulas(textToTranslate);

      const result = await translateService.translateText({
        documentId: currentDocument.documentId,
        pageNumber: selection.pageNumber,
        text: protection.hasFormulas ? protection.protectedText : textToTranslate,
        targetLang: "zh-CN",
        context: selection.context,
        formulaProtected: protection.hasFormulas,
      });

      const finalTranslation = protection.hasFormulas
        ? restoreFormulas(result.translatedText, protection.formulaMap)
        : result.translatedText;

      setTranslationPreview(finalTranslation);
      setTranslationModel(result.model);
      setTranslationCached(result.cached);
      setStatus(result.cached ? "译文已返回（命中缓存）" : "译文已返回");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "翻译失败");
    } finally {
      setIsTranslating(false);
    }
  }

  async function handleHighlightSelection(color: string) {
    if (!currentDocument || !selectedTextSelection) {
      return;
    }

    try {
      await noteService.saveNote({
        documentId: currentDocument.documentId,
        pageNumber: selectedTextSelection.pageNumber,
        noteType: "highlight",
        selectedText: selectedTextSelection.selectedText,
        color,
        anchorJson: selectedTextSelection.anchorJson,
        rectsJson: selectedTextSelection.rectsJson,
      });

      await loadDocumentArtifacts(currentDocument.documentId);
      setStatus("已高亮选区");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "高亮选区失败");
    }
  }

  async function handleFavoriteSelection() {
    if (!currentDocument || !selectedTextSelection) {
      return;
    }

    try {
      await noteService.saveNote({
        documentId: currentDocument.documentId,
        pageNumber: selectedTextSelection.pageNumber,
        noteType: "highlight",
        selectedText: selectedTextSelection.selectedText,
        translatedText: translationPreview || undefined,
        comment: "收藏选区",
        color: highlightColor,
        anchorJson: selectedTextSelection.anchorJson,
        rectsJson: selectedTextSelection.rectsJson,
      });

      await loadDocumentArtifacts(currentDocument.documentId);
      setStatus("已收藏选区");
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "收藏选区失败");
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
      setTargetPage(note.pageNumber);
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

    window.setTimeout(() => {
      setActiveNoteId(null);
    }, 2200);
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
    switch (action.type) {
      case "open_library":
        openLibraryView(undefined, currentDocument?.libraryFolderId ?? selectedLibraryFolderId);
        void Promise.all([loadRecentDocuments(), loadLibrarySnapshot()]);
        setStatus("已回到论文仓库");
        break;
      case "open_file":
        void handleOpenFile(workspaceMode === "library" ? selectedLibraryFolderId : undefined);
        break;
      case "open_recent":
        void openFileByPath(action.filePath);
        break;
      case "open_settings":
        setSettingsOpen(true);
        break;
      case "toggle_search":
        if (workspaceMode === "reader") {
          setSearchOpen((open) => !open);
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
      case "toggle_focus_mode":
        if (workspaceMode === "reader") {
          setFocusMode((enabled) => !enabled);
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
        const [themeSettings, hoverTranslateSettings] = await Promise.all([
          settingsService.getThemeSettings(),
          settingsService.getHoverTranslateSettings(),
        ]);

        if (!canceled) {
          applyThemeColor(themeSettings.accentColor);
          setHoverTranslateEnabled(hoverTranslateSettings.enabled);
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
      lastPage: displayPage,
      lastZoom: displayZoom,
    });
  }, [currentDocument, displayPage, pageCount, displayZoom]);

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
      setHoverTranslationVisible(false);
    });

    revealDocumentGlance();
  }, [currentDocument?.documentId, displayPage]);

  useEffect(() => {
    if (aiPanelOpen) {
      setHoverTranslationVisible(false);
    }
  }, [aiPanelOpen]);

  useEffect(() => {
    if (!selectedTextSelection || !currentDocument) {
      return;
    }

    if (!hoverTranslateEnabled) {
      return;
    }

    setActiveTab("translation");

    if (aiPanelOpen) {
      void runSelectionTranslation(selectedTextSelection);
    } else {
      setHoverTranslationVisible(true);
      void runSelectionTranslation(selectedTextSelection);
    }
  }, [currentDocument, hoverTranslateEnabled, selectedTextSelection?.signature]);

  useEffect(() => {
    if (!selectedTextSelection || notes.length === 0) {
      setIsSelectionHighlighted(false);
      setIsSelectionFavorited(false);
      return;
    }

    const matchingNotes = notes.filter(
      (note) =>
        note.pageNumber === selectedTextSelection.pageNumber &&
        note.selectedText === selectedTextSelection.selectedText,
    );

    setIsSelectionHighlighted(
      matchingNotes.some((note) => note.noteType === "highlight" && note.comment !== "收藏选区"),
    );
    setIsSelectionFavorited(
      matchingNotes.some((note) => note.comment === "收藏选区"),
    );
  }, [selectedTextSelection?.signature, notes]);

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

      if (documentGlanceDebounceRef.current !== null) {
        window.clearTimeout(documentGlanceDebounceRef.current);
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
          <div className="reader-viewport">
            <div className="reader-stage">
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
                    documentGlanceVisible
                      ? "document-glance document-glance--visible"
                      : "document-glance"
                  }
                  title={currentDocument.fileName}
                >
                  {currentDocument.fileName}
                </div>
              ) : null}

              <PdfViewer
                document={currentDocument}
                targetPage={targetPage}
                resetZoomVersion={resetZoomVersion}
                zoomMode={zoomMode}
                searchQuery={searchQuery}
                selectionMode={selectionMode}
                focusMode={focusMode}
                focusColumnMode={focusColumnMode}
                onToggleFocusMode={() => setFocusMode((enabled) => !enabled)}
                onDisplayPageChange={handleDisplayPageChange}
                notes={notes}
                formulas={formulas}
                activeNoteId={activeNoteId}
                onPageCountChange={setPageCount}
                onRenderedScaleChange={setDisplayZoom}
                onStatusChange={setStatus}
                onSearchResultsChange={handleSearchResultsChange}
                onZoomRequest={updateZoom}
                onViewerActivity={() => revealDocumentGlance()}
                onFormulaAreaCapture={(capture) => {
                  void handleFormulaAreaCapture(capture);
                }}
                onTextSelectionChange={(selection) => {
                  startTransition(() => {
                    setSelectedTextSelection(selection);

                    if (selection) {
                      setActiveTab("translation");
                    } else {
                      setHoverTranslationVisible(false);
                    }
                  });
                }}
              />

              <HoverTranslation
                text={translationPreview}
                visible={hoverTranslationVisible && !aiPanelOpen}
                highlightColor={highlightColor}
                isHighlighted={isSelectionHighlighted}
                isFavorited={isSelectionFavorited}
                onDismiss={() => setHoverTranslationVisible(false)}
                onHighlight={(color) => { void handleHighlightSelection(color); }}
                onFavorite={() => { void handleFavoriteSelection(); }}
                onColorChange={setHighlightColor}
              />
            </div>

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
              <PanelRightOpen size={18} strokeWidth={1.5} />
            </button>

            <div
              className={
                aiPanelOpen
                  ? "reader-panel reader-panel--visible"
                  : "reader-panel"
              }
            >
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
          </div>
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
          {isReaderMode ? (
            <>
              <button
                className="secondary status-bar-button"
                disabled={displayPage <= 1 || !pageCount}
                onClick={handlePrevPage}
              >
                上一页
              </button>
              <button
                className="secondary status-bar-button"
                disabled={displayPage >= pageCount || !pageCount}
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
            {isReaderMode && currentDocument ? `${displayPage}/${pageCount || 0}` : "论文仓库"}
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
        focusColumnMode={focusColumnMode}
        onFocusColumnModeChange={setFocusColumnMode}
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
