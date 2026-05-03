import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { flushSync } from "react-dom";

import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { TextLayerBuilder } from "pdfjs-dist/legacy/web/pdf_viewer.mjs";

import type { FormulaItem, NormalizedRect, NoteItem, OpenDocumentResult } from "@shared/types";

import { FocusModeOverlay } from "./FocusModeOverlay";
import { documentService } from "../services/documentService";
import type { FormulaCaptureDraft, ReaderSearchResult, ReaderTextSelection } from "../types/reader";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/* ───────── Props ───────── */

type PdfViewerProps = {
  document: OpenDocumentResult | null;
  targetPage: number;
  resetZoomVersion: number;
  zoomMode?: ("fit-width" | "manual") | "custom";
  searchQuery?: string;
  selectionMode?: "text" | "formula";
  focusMode?: boolean;
  focusColumnMode?: "single" | "double";
  notes?: NoteItem[];
  formulas?: FormulaItem[];
  activeNoteId?: string | null;
  onPageCountChange: (pageCount: number) => void;
  onRenderedScaleChange?: (scale: number) => void;
  onStatusChange: (status: string) => void;
  onTextSelectionChange: (selection: ReaderTextSelection | null) => void;
  onSearchResultsChange?: (results: ReaderSearchResult[]) => void;
  onZoomRequest?: (nextZoom: number) => void;
  onViewerActivity?: () => void;
  onFormulaAreaCapture?: (capture: FormulaCaptureDraft) => void;
  onToggleFocusMode?: () => void;
  onDisplayPageChange: (page: number) => void;
};

/* ───────── Types ───────── */

type PageMeta = {
  pageNumber: number;
  originalWidth: number;
  originalHeight: number;
};

type PageSlot = {
  meta: PageMeta;

  scaledWidth: number;
  scaledHeight: number;

  surfaceEl: HTMLDivElement | null;
  contentEl: HTMLDivElement | null;
  canvasEl: HTMLCanvasElement | null;
  textLayerHostEl: HTMLDivElement | null;

  renderedScale: number | null;
  renderingScale: number | null;

  renderTask: RenderTask | null;
  renderSettled: Promise<void>;

  textLayerBuilder: TextLayerBuilder | null;
  detachSelection: (() => void) | undefined;

  offscreenCanvas: HTMLCanvasElement | null;
  pageText: string | null;
};

type ZoomAnchor = {
  pageNumber: number;
  xRatio: number;
  yRatio: number;
  clientX: number;
  clientY: number;
};

type ZoomSession = {
  pageNumber: number;
  xRatio: number;
  yRatio: number;
  clientX: number;
  clientY: number;
  baseZoom: number;
  baseDocRect: DOMRect;
  originX: number;
  originY: number;
};

type PixelRect = { x: number; y: number; width: number; height: number };

type FormulaDragState = {
  startX: number;
  startY: number;
  boundsWidth: number;
  boundsHeight: number;
  pageNumber: number;
};

/* ───────── Constants ───────── */

const RENDER_BUFFER = 2;
const MAX_CONCURRENT_RENDERS = 2;
const PAGE_GAP = 12;
const PAGE_PADDING_TOP = 20;

/* ───────── Component ───────── */

export function PdfViewer(props: PdfViewerProps) {
  const viewerRef = useRef<HTMLElement | null>(null);
  const documentRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const pagesMetaRef = useRef<PageMeta[]>([]);
  const slotsRef = useRef<Map<number, PageSlot>>(new Map());
  const pageTextCacheRef = useRef<Map<number, string>>(new Map());
  const formulaDragRef = useRef<FormulaDragState | null>(null);

  const displayPageRef = useRef(1);
  const initialScrollDoneRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const scrollCorrectionPageRef = useRef<number | null>(null);

  const zoomingRef = useRef(false);
  const commitAnchorRef = useRef<ZoomAnchor | null>(null);
  const pendingPreviewZoomRef = useRef(1);
  const zoomCommitTimerRef = useRef<number | null>(null);
  const zoomSessionRef = useRef<ZoomSession | null>(null);
  const zoomRenderCenterPageRef = useRef<number | null>(null);
  const renderVersionRef = useRef(0);

  const renderQueueRef = useRef<Set<number>>(new Set());
  const renderingCountRef = useRef(0);
  const renderPumpRafRef = useRef<number | null>(null);

  const propsRef = useRef(props);
  propsRef.current = props;

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragRect, setDragRect] = useState<PixelRect | null>(null);
  const [focusPageNumber, setFocusPageNumber] = useState(1);

  const [layoutZoom, setLayoutZoom] = useState(1);
  const [renderZoom, setRenderZoom] = useState(1);
  const [isZooming, setIsZooming] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const [previewScale, setPreviewScale] = useState(1);
  const [previewOriginX, setPreviewOriginX] = useState(0);
  const [previewOriginY, setPreviewOriginY] = useState(0);

  const layoutZoomRef = useRef(layoutZoom);
  const renderZoomRef = useRef(renderZoom);
  layoutZoomRef.current = layoutZoom;
  renderZoomRef.current = renderZoom;

  const emitStatusChange = useEffectEvent((status: string) => props.onStatusChange(status));
  const emitTextSelectionChange = useEffectEvent((selection: ReaderTextSelection | null) => {
    props.onTextSelectionChange(selection);
  });
  const emitSearchResultsChange = useEffectEvent((results: ReaderSearchResult[]) => {
    props.onSearchResultsChange?.(results);
  });
  const emitRenderedScaleChange = useEffectEvent((scale: number) => {
    props.onRenderedScaleChange?.(scale);
  });
  const emitDisplayPageChange = useEffectEvent((page: number) => {
    props.onDisplayPageChange(page);
  });
  const emitZoomRequest = useEffectEvent((nextZoom: number) => {
    props.onZoomRequest?.(nextZoom);
  });
  const emitViewerActivity = useEffectEvent(() => props.onViewerActivity?.());
  const emitFormulaAreaCapture = useEffectEvent((capture: FormulaCaptureDraft) => {
    props.onFormulaAreaCapture?.(capture);
  });

  /* ─────── Derived ─────── */

  for (const slot of slotsRef.current.values()) {
    slot.scaledWidth = slot.meta.originalWidth * layoutZoom;
    slot.scaledHeight = slot.meta.originalHeight * layoutZoom;
  }

  /* ─────── Load PDF ─────── */

  useEffect(() => {
    let disposed = false;

    async function loadPdf() {
      if (!props.document) {
        setPdf(null);
        setError(null);
        props.onPageCountChange(0);
        cleanupSlots();
        emitTextSelectionChange(null);
        emitSearchResultsChange([]);
        initialScrollDoneRef.current = false;
        return;
      }

      setLoading(true);
      setError(null);
      initialScrollDoneRef.current = false;
      emitStatusChange(`正在加载 ${props.document.fileName}`);

      try {
        const binary = await documentService.readDocumentBinary({ filePath: props.document.filePath });
        const loadingTask = getDocument({ data: binary });
        const loadedPdf = await loadingTask.promise;

        if (disposed) {
          await loadedPdf.destroy();
          return;
        }

        const prevPdf = pdfRef.current;
        pdfRef.current = loadedPdf;
        void prevPdf?.destroy();

        cleanupSlots();

        const meta: PageMeta[] = [];
        for (let i = 1; i <= loadedPdf.numPages; i++) {
          const page = await loadedPdf.getPage(i);
          if (disposed) return;
          const vp = page.getViewport({ scale: 1 });
          meta.push({ pageNumber: i, originalWidth: vp.width, originalHeight: vp.height });
        }

        pagesMetaRef.current = meta;
        setPdf(loadedPdf);
        props.onPageCountChange(loadedPdf.numPages);
        emitStatusChange(`已加载 ${props.document.fileName}`);
      } catch (cause) {
        if (disposed) return;
        const message = cause instanceof Error ? cause.message : "PDF 加载失败";
        setError(message);
        setPdf(null);
        pdfRef.current = null;
        pagesMetaRef.current = [];
        props.onPageCountChange(0);
        emitStatusChange(message);
      } finally {
        if (!disposed) setLoading(false);
      }
    }

    void loadPdf();
    return () => { disposed = true; };
  }, [props.document]);

  /* ─────── Cleanup on unmount ─────── */

  useEffect(() => {
    return () => {
      if (zoomCommitTimerRef.current !== null) window.clearTimeout(zoomCommitTimerRef.current);
      if (programmaticScrollTimerRef.current !== null) window.clearTimeout(programmaticScrollTimerRef.current);
      if (renderPumpRafRef.current !== null) window.cancelAnimationFrame(renderPumpRafRef.current);
      cleanupSlots();
      void pdfRef.current?.destroy();
      pdfRef.current = null;
    };
  }, []);

  /* ─────── Initialize slots on PDF load ─────── */

  useEffect(() => {
    if (!pdf || pagesMetaRef.current.length === 0) return;

    for (const meta of pagesMetaRef.current) {
      if (!slotsRef.current.has(meta.pageNumber)) {
        slotsRef.current.set(meta.pageNumber, createSlot(meta, layoutZoomRef.current));
      }
    }

    scheduleRenderAround(props.targetPage);
  }, [pdf]);

  /* ─────── Scroll to target page ─────── */

  useEffect(() => {
    if (!pdf) return;

    const frame = requestAnimationFrame(() => {
      scrollToPage(props.targetPage);
      if (!initialScrollDoneRef.current) initialScrollDoneRef.current = true;
      scheduleRenderAround(props.targetPage);
    });

    return () => cancelAnimationFrame(frame);
  }, [props.targetPage, pdf]);

  /* ─────── Reset zoom on new document ─────── */

  useEffect(() => {
    if (!props.document) return;
    setLayoutZoom(1);
    setRenderZoom(1);
    setIsZooming(false);
    setPreviewActive(false);
    setPreviewScale(1);
    setPreviewOriginX(0);
    setPreviewOriginY(0);
    zoomingRef.current = false;
    commitAnchorRef.current = null;
    pendingPreviewZoomRef.current = 1;
    zoomSessionRef.current = null;
    if (zoomCommitTimerRef.current !== null) {
      window.clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
  }, [props.document]);

  useEffect(() => {
    if (!pdfRef.current) return;
    const viewer = viewerRef.current;
    if (!viewer) return;
    const rect = viewer.getBoundingClientRect();
    const anchor = captureZoomAnchor(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    commitAnchorRef.current = anchor;
    pendingPreviewZoomRef.current = 1;
    setLayoutZoom(1);
    renderVersionRef.current += 1;
    setRenderZoom(1);
    emitZoomRequest(1);
  }, [props.resetZoomVersion]);

  /* ─────── Scroll event (activity only) ─────── */

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const handleScroll = () => {
      emitViewerActivity();
    };

    viewer.addEventListener("scroll", handleScroll, { passive: true });
    return () => viewer.removeEventListener("scroll", handleScroll);
  }, [pdf]);

  /* ─────── ResizeObserver for fit-width ─────── */

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      if ((propsRef.current.zoomMode ?? "fit-width") !== "fit-width") return;
      const meta = pagesMetaRef.current;
      if (meta.length === 0) return;
      const nextScale = computeEffectiveScale(meta, viewerRef.current, 1, "fit-width");
      if (Math.abs(nextScale - layoutZoomRef.current) < 0.005) return;
      const viewerEl = viewerRef.current;
      if (viewerEl) {
        const viewerRect = viewerEl.getBoundingClientRect();
        pendingPreviewZoomRef.current = nextScale;
        const anchor = captureZoomAnchor(
          viewerRect.left + viewerRect.width / 2,
          viewerRect.top + viewerRect.height / 2,
        );
        commitAnchorRef.current = anchor;
        setLayoutZoom(nextScale);
        renderVersionRef.current += 1;
        setRenderZoom(nextScale);
        emitZoomRequest(nextScale);
      }
    });

    observer.observe(viewer);
    return () => observer.disconnect();
  }, []);

  /* ─────── Ctrl+Wheel zoom ─────── */

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const handleWheel = (event: WheelEvent) => {
      const target = event.target;
      if (!pdfRef.current || !(target instanceof Node) || !viewer.contains(target)) return;
      if (!event.ctrlKey) return;

      event.preventDefault();
      event.stopPropagation();
      emitViewerActivity();

      const currentScale = pendingPreviewZoomRef.current;
      const nextScale = getNextZoomByWheel(currentScale, event.deltaY);
      if (nextScale === currentScale) return;

      requestPreviewZoom(event.clientX, event.clientY, event.deltaY);
    };

    window.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", handleWheel, { capture: true });
  }, []);

  /* ─────── RenderZoom commit → schedule renders ─────── */

  useEffect(() => {
    if (!pdfRef.current) return;

    const centerPage = zoomRenderCenterPageRef.current ?? displayPageRef.current;
    zoomRenderCenterPageRef.current = null;
    cancelStaleRenders();
    scheduleRenderAround(centerPage);

    window.setTimeout(() => {
      setIsZooming(false);
      zoomingRef.current = false;
    }, 300);
  }, [renderZoom]);

  /* ─────── Search effect ─────── */

  useEffect(() => {
    let canceled = false;

    async function runSearch() {
      if (!pdf) {
        emitSearchResultsChange([]);
        return;
      }

      const normalizedQuery = normalizeSearchQuery(props.searchQuery);
      if (!normalizedQuery) {
        emitSearchResultsChange([]);
        return;
      }

      const results: ReaderSearchResult[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        let text = pageTextCacheRef.current.get(pageNumber);
        if (text === undefined) {
          try {
            const page = await pdf.getPage(pageNumber);
            text = await extractPageText(page);
          } catch {
            continue;
          }
          if (canceled) return;
          pageTextCacheRef.current.set(pageNumber, text);
        }
        results.push(...collectSearchResults(text, normalizedQuery, pageNumber));
      }

      if (!canceled) emitSearchResultsChange(results);
    }

    void runSearch();
    return () => { canceled = true; };
  }, [pdf, props.searchQuery, props.document?.documentId]);

  /* ─────── Search highlights ─────── */

  useEffect(() => {
    for (const slot of slotsRef.current.values()) {
      if (slot.textLayerBuilder?.div) {
        applySearchHighlights(slot.textLayerBuilder.div, props.searchQuery);
      }
    }
  }, [props.searchQuery]);

  /* ─────── Focus mode ─────── */

  useEffect(() => {
    if (!props.focusMode || !viewerRef.current) return;

    const handleMouseMove = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const surface = target.closest("[data-page]") as HTMLElement | null;
      if (!surface) return;
      const pageNumber = Number(surface.dataset.page);
      if (!Number.isNaN(pageNumber)) setFocusPageNumber(pageNumber);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [props.focusMode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !props.onToggleFocusMode) return;

    const handleDoubleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(".textLayer span, .textLayer br")) return;
      if (target.closest("button, a, input, [role='button']")) return;
      props.onToggleFocusMode?.();
    };

    viewer.addEventListener("dblclick", handleDoubleClick);
    return () => viewer.removeEventListener("dblclick", handleDoubleClick);
  }, [props.onToggleFocusMode]);

  /* ─────── Selection mode ─────── */

  useEffect(() => {
    if (props.selectionMode !== "formula") {
      setDragRect(null);
      formulaDragRef.current = null;
    }
  }, [props.selectionMode]);

  useEffect(() => {
    if (props.selectionMode !== "formula") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDragRect(null);
        formulaDragRef.current = null;
        emitStatusChange("已退出本次公式框选");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [props.selectionMode]);

  /* ─────── Active note scroll ─────── */

  useEffect(() => {
    if (!props.activeNoteId) return;

    const timer = window.setTimeout(() => {
      viewerRef.current
        ?.querySelector(".viewer-note-highlight--active, .viewer-note-favorite--active")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [props.activeNoteId, props.notes]);

  /* ═══════════════════════════════════════════
     CORE: Page Navigation
     ═══════════════════════════════════════════ */

  function scrollToPage(pageNumber: number) {
    const viewer = viewerRef.current;
    const slot = slotsRef.current.get(pageNumber);
    if (!viewer || !slot?.surfaceEl) return;

    const top = computePageTop(pageNumber);

    programmaticScrollRef.current = true;
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current);
    }

    viewer.scrollTo({ top: Math.max(top - PAGE_PADDING_TOP, 0), behavior: "auto" });
    reportDisplayPage(pageNumber);
    scrollCorrectionPageRef.current = pageNumber;

    programmaticScrollTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticScrollTimerRef.current = null;
      scheduleRenderAround(pageNumber);
    }, 200);
  }

  function computePageTop(pageNumber: number): number {
    let top = 0;
    for (let i = 1; i < pageNumber; i++) {
      const slot = slotsRef.current.get(i);
      if (slot) {
        top += slot.scaledHeight + PAGE_GAP;
      } else {
        const meta = pagesMetaRef.current[i - 1];
        if (meta) top += meta.originalHeight * layoutZoomRef.current + PAGE_GAP;
      }
    }
    return top;
  }

  /* ─────── IntersectionObserver for displayPage ─────── */

  const observerRef = useRef<IntersectionObserver | null>(null);
  const observerRatiosRef = useRef<Map<Element, number>>(new Map());

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !pdf) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          observerRatiosRef.current.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
        }

        if (programmaticScrollRef.current || zoomingRef.current) return;

        let bestPage = displayPageRef.current;
        let bestRatio = 0;

        for (const [el, ratio] of observerRatiosRef.current) {
          if (ratio <= 0) continue;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            const page = Number((el as HTMLElement).dataset.page);
            if (!Number.isNaN(page)) bestPage = page;
          }
        }

        if (bestPage !== displayPageRef.current) {
          reportDisplayPage(bestPage);
        }

        scheduleRenderAround(bestPage);
      },
      { root: viewer, threshold: [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1] },
    );

    observerRef.current = observer;

    return () => {
      observer.disconnect();
      observerRef.current = null;
      observerRatiosRef.current.clear();
    };
  }, [pdf]);

  function reportDisplayPage(pageNumber: number) {
    if (pageNumber === displayPageRef.current) return;
    displayPageRef.current = pageNumber;
    emitDisplayPageChange(pageNumber);

    const slot = slotsRef.current.get(pageNumber);
    if (slot?.renderedScale) {
      emitRenderedScaleChange(slot.renderedScale);
    }
  }

  /* ═══════════════════════════════════════════
     CORE: Render Scheduler
     ═══════════════════════════════════════════ */

  function scheduleRenderAround(centerPage: number) {
    const loadedPdf = pdfRef.current;
    if (!loadedPdf) return;

    const currentScale = renderZoomRef.current;

    for (let p = centerPage - RENDER_BUFFER; p <= centerPage + RENDER_BUFFER; p++) {
      if (p < 1 || p > loadedPdf.numPages) continue;
      const slot = slotsRef.current.get(p);
      if (!slot) continue;
      if (slot.renderedScale !== null && Math.abs(slot.renderedScale - currentScale) < 0.005) continue;
      if (slot.renderingScale !== null && Math.abs(slot.renderingScale - currentScale) < 0.005) continue;
      renderQueueRef.current.add(p);
    }

    pumpRenderQueue();
  }

  function pumpRenderQueue() {
    if (renderPumpRafRef.current !== null) return;

    renderPumpRafRef.current = requestAnimationFrame(() => {
      renderPumpRafRef.current = null;

      while (
        renderingCountRef.current < MAX_CONCURRENT_RENDERS &&
        renderQueueRef.current.size > 0
      ) {
        const pageNumber = takeNextPage();
        if (pageNumber === null) break;

        const slot = slotsRef.current.get(pageNumber);
        if (!slot) continue;

        const targetScale = renderZoomRef.current;
        if (slot.renderedScale !== null && Math.abs(slot.renderedScale - targetScale) < 0.005) continue;
        if (slot.renderingScale !== null && Math.abs(slot.renderingScale - targetScale) < 0.005) continue;

        renderingCountRef.current++;
        slot.renderingScale = targetScale;

        void renderSlot(pageNumber, slot, targetScale).finally(() => {
          renderingCountRef.current--;
          if (renderQueueRef.current.size > 0) pumpRenderQueue();
        });
      }
    });
  }

  function takeNextPage(): number | null {
    if (renderQueueRef.current.size === 0) return null;
    const center = displayPageRef.current;
    let bestPage: number | null = null;
    let bestDist = Infinity;
    for (const page of renderQueueRef.current) {
      const dist = Math.abs(page - center);
      if (dist < bestDist) {
        bestDist = dist;
        bestPage = page;
      }
    }
    if (bestPage !== null) renderQueueRef.current.delete(bestPage);
    return bestPage;
  }

  /* ═══════════════════════════════════════════
     CORE: Page Rendering
     ═══════════════════════════════════════════ */

  async function renderSlot(pageNumber: number, slot: PageSlot, targetScale: number) {
    const loadedPdf = pdfRef.current;
    if (!loadedPdf) return;

    const rv = renderVersionRef.current;
    const scale = renderZoomRef.current;

    const page = await loadedPdf.getPage(pageNumber);
    if (renderVersionRef.current !== rv || Math.abs(renderZoomRef.current - targetScale) > 0.004) return;

    cancelSlotTask(slot);
    await slot.renderSettled;
    if (renderVersionRef.current !== rv || Math.abs(renderZoomRef.current - targetScale) > 0.004) return;

    const viewport = page.getViewport({ scale: Math.max(targetScale, 0.4) });
    const dpr = window.devicePixelRatio || 1;
    const pixelW = Math.max(1, Math.floor(viewport.width * dpr));
    const pixelH = Math.max(1, Math.floor(viewport.height * dpr));

    let offscreen = slot.offscreenCanvas;
    if (!offscreen) {
      offscreen = document.createElement("canvas");
      slot.offscreenCanvas = offscreen;
    }
    offscreen.width = pixelW;
    offscreen.height = pixelH;

    const ctx = offscreen.getContext("2d");
    if (!ctx) return;

    const renderTask = page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });
    slot.renderTask = renderTask;
    slot.renderSettled = renderTask.promise.catch(() => undefined).finally(() => {
      if (slot.renderTask === renderTask) slot.renderTask = null;
    });

    await renderTask.promise;
    if (renderVersionRef.current !== rv || Math.abs(renderZoomRef.current - targetScale) > 0.004) return;

    const pageText = await extractPageText(page);
    if (renderVersionRef.current !== rv || Math.abs(renderZoomRef.current - targetScale) > 0.004) return;
    pageTextCacheRef.current.set(pageNumber, pageText);
    slot.pageText = pageText;

    const textLayerBuilder = new TextLayerBuilder({ pdfPage: page });
    await textLayerBuilder.render(viewport);
    if (renderVersionRef.current !== rv || Math.abs(renderZoomRef.current - targetScale) > 0.004) {
      textLayerBuilder.cancel();
      return;
    }

    slot.textLayerBuilder?.cancel();
    slot.detachSelection?.();

    slot.renderedScale = targetScale;
    slot.renderingScale = null;
    slot.textLayerBuilder = textLayerBuilder;

    commitSlot(slot, viewport, pixelW, pixelH, textLayerBuilder);
    applySearchHighlights(textLayerBuilder.div, propsRef.current.searchQuery);

    slot.detachSelection = attachTextSelectionListeners({
      textLayerDiv: textLayerBuilder.div,
      pageNumber,
      pageText,
      onSelection: (selection) => {
        if (propsRef.current.selectionMode === "formula") return;
        emitTextSelectionChange(selection);
        if (selection) {
          emitStatusChange(`已选中第 ${selection.pageNumber} 页文本，正在准备翻译`);
        }
      },
    });

    if (pageNumber === displayPageRef.current) {
      emitRenderedScaleChange(targetScale);
    }

    if (pageNumber === scrollCorrectionPageRef.current) {
      scrollCorrectionPageRef.current = null;
      const viewer = viewerRef.current;
      if (viewer && slot.surfaceEl) {
        const expectedTop = Math.max(computePageTop(pageNumber) - PAGE_PADDING_TOP, 0);
        if (Math.abs(viewer.scrollTop - expectedTop) > 4) {
          viewer.scrollTo({ top: expectedTop, behavior: "auto" });
        }
      }
    }
  }

  function commitSlot(
    slot: PageSlot,
    _viewport: { width: number; height: number },
    pixelW: number,
    pixelH: number,
    textLayerBuilder: TextLayerBuilder,
  ) {
    const { canvasEl, textLayerHostEl } = slot;
    if (!canvasEl || !textLayerHostEl) return;

    canvasEl.width = pixelW;
    canvasEl.height = pixelH;

    const visibleCtx = canvasEl.getContext("2d");
    if (visibleCtx && slot.offscreenCanvas) {
      visibleCtx.clearRect(0, 0, pixelW, pixelH);
      visibleCtx.drawImage(slot.offscreenCanvas, 0, 0);
    }

    textLayerBuilder.div.style.setProperty("--scale-factor", String(slot.renderedScale));
    textLayerHostEl.style.setProperty("--scale-factor", String(slot.renderedScale));
    textLayerHostEl.style.visibility = "";
    textLayerHostEl.replaceChildren(textLayerBuilder.div);
  }

  function cancelSlotTask(slot: PageSlot) {
    if (!slot.renderTask) return;
    try { slot.renderTask.cancel(); } catch { /* already settled */ }
    slot.renderTask = null;
  }

  function cleanupSlots() {
    for (const slot of slotsRef.current.values()) {
      cancelSlotTask(slot);
      slot.textLayerBuilder?.cancel();
      slot.detachSelection?.();
      if (slot.offscreenCanvas) {
        slot.offscreenCanvas.width = 0;
        slot.offscreenCanvas.height = 0;
        slot.offscreenCanvas = null;
      }
    }
    slotsRef.current.clear();
    pageTextCacheRef.current.clear();
    renderQueueRef.current.clear();
    renderingCountRef.current = 0;
    pagesMetaRef.current = [];
    displayPageRef.current = 1;
    layoutZoomRef.current = 1;
    renderZoomRef.current = 1;
    initialScrollDoneRef.current = false;
    commitAnchorRef.current = null;
    pendingPreviewZoomRef.current = 1;
    zoomSessionRef.current = null;
    renderVersionRef.current = 0;
    scrollCorrectionPageRef.current = null;
    if (zoomCommitTimerRef.current !== null) {
      window.clearTimeout(zoomCommitTimerRef.current);
      zoomCommitTimerRef.current = null;
    }
  }

  /* ═══════════════════════════════════════════
     CORE: Zoom (transform-origin approach)
     ═══════════════════════════════════════════ */

  function ensureZoomSession(clientX: number, clientY: number): ZoomSession | null {
    if (zoomSessionRef.current) return zoomSessionRef.current;

    const doc = documentRef.current;
    if (!doc) return null;

    const anchor = captureZoomAnchor(clientX, clientY);
    if (!anchor) return null;

    const baseDocRect = doc.getBoundingClientRect();

    const session: ZoomSession = {
      pageNumber: anchor.pageNumber,
      xRatio: anchor.xRatio,
      yRatio: anchor.yRatio,
      clientX: anchor.clientX,
      clientY: anchor.clientY,
      baseZoom: layoutZoomRef.current,
      baseDocRect,
      originX: clientX - baseDocRect.left,
      originY: clientY - baseDocRect.top,
    };

    zoomSessionRef.current = session;
    return session;
  }

  function getNextZoomByWheel(currentZoom: number, deltaY: number): number {
    const sensitivity = 0.0015;
    return clampScale(currentZoom * Math.exp(-deltaY * sensitivity));
  }

  function requestPreviewZoom(clientX: number, clientY: number, deltaY: number) {
    const anchor = captureZoomAnchor(clientX, clientY);
    if (!anchor) return;
    const nextZoom = getNextZoomByWheel(pendingPreviewZoomRef.current, deltaY);
    if (Math.abs(nextZoom - pendingPreviewZoomRef.current) < 0.001) return;

    pendingPreviewZoomRef.current = nextZoom;
    zoomRenderCenterPageRef.current = anchor.pageNumber;

    zoomSessionRef.current = null;
    setIsZooming(true);
    zoomingRef.current = true;

    flushSync(() => {
      setLayoutZoom(nextZoom);
      setPreviewActive(false);
      setPreviewScale(1);
      setPreviewOriginX(0);
      setPreviewOriginY(0);
    });

    restoreZoomAnchor(anchor);

    if (zoomCommitTimerRef.current !== null) {
      window.clearTimeout(zoomCommitTimerRef.current);
    }

    zoomCommitTimerRef.current = window.setTimeout(() => {
      zoomCommitTimerRef.current = null;
      commitPreviewZoom();
    }, 180);
  }

  function commitPreviewZoom() {
    const finalZoom = pendingPreviewZoomRef.current;

    renderVersionRef.current += 1;
    setRenderZoom(finalZoom);
    emitZoomRequest(finalZoom);
    emitStatusChange(`缩放 ${Math.round(finalZoom * 100)}%`);

    zoomSessionRef.current = null;
  }

  useLayoutEffect(() => {
    const anchor = commitAnchorRef.current;
    if (!anchor) return;

    requestAnimationFrame(() => {
      if (!commitAnchorRef.current) return;
      restoreZoomAnchor(commitAnchorRef.current);
      commitAnchorRef.current = null;

      window.setTimeout(() => {
        if (!zoomSessionRef.current) {
          setIsZooming(false);
          zoomingRef.current = false;
        }
      }, 150);
    });
  }, [layoutZoom]);

  function captureZoomAnchor(clientX: number, clientY: number): ZoomAnchor | null {
    for (const [, slot] of slotsRef.current) {
      if (!slot.surfaceEl) continue;
      const rect = slot.surfaceEl.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        const page = Number((slot.surfaceEl as HTMLElement).dataset.page);
        return {
          pageNumber: Number.isNaN(page) ? displayPageRef.current : page,
          xRatio: (clientX - rect.left) / rect.width,
          yRatio: (clientY - rect.top) / rect.height,
          clientX,
          clientY,
        };
      }
    }
    return null;
  }

  function restoreZoomAnchor(anchor: ZoomAnchor) {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const slot = slotsRef.current.get(anchor.pageNumber);
    if (!slot?.surfaceEl || !slot.scaledHeight) return;

    const pageRect = slot.surfaceEl.getBoundingClientRect();

    const newClientX = pageRect.left + pageRect.width * anchor.xRatio;
    const newClientY = pageRect.top + pageRect.height * anchor.yRatio;

    viewer.scrollLeft += newClientX - anchor.clientX;
    viewer.scrollTop += newClientY - anchor.clientY;
  }

  function cancelStaleRenders() {
    renderQueueRef.current.clear();
    for (const slot of slotsRef.current.values()) {
      if (slot.renderingScale !== null) {
        cancelSlotTask(slot);
        slot.renderingScale = null;
      }
    }
  }

  /* ═══════════════════════════════════════════
     Formula Capture
     ═══════════════════════════════════════════ */

  function handleFormulaMouseDown(event: ReactMouseEvent<HTMLDivElement>, pageNumber: number) {
    if (props.selectionMode !== "formula" || event.button !== 0) return;
    event.preventDefault();

    const surface = slotsRef.current.get(pageNumber)?.surfaceEl;
    if (!surface) return;

    const bounds = surface.getBoundingClientRect();
    const startX = clampPixel(event.clientX - bounds.left, bounds.width);
    const startY = clampPixel(event.clientY - bounds.top, bounds.height);
    formulaDragRef.current = { startX, startY, boundsWidth: bounds.width, boundsHeight: bounds.height, pageNumber };
    setDragRect({ x: startX, y: startY, width: 0, height: 0 });
    emitStatusChange("正在框选公式区域");
  }

  function handleFormulaMouseMove(event: ReactMouseEvent<HTMLDivElement>, pageNumber: number) {
    if (props.selectionMode !== "formula" || !formulaDragRef.current) return;
    if (formulaDragRef.current.pageNumber !== pageNumber) return;
    event.preventDefault();

    const surface = slotsRef.current.get(pageNumber)?.surfaceEl;
    if (!surface) return;

    const bounds = surface.getBoundingClientRect();
    setDragRect(toPixelRect(
      formulaDragRef.current.startX,
      formulaDragRef.current.startY,
      clampPixel(event.clientX - bounds.left, bounds.width),
      clampPixel(event.clientY - bounds.top, bounds.height),
    ));
  }

  function handleFormulaMouseUp(event: ReactMouseEvent<HTMLDivElement>, pageNumber: number) {
    if (props.selectionMode !== "formula" || !formulaDragRef.current) return;
    if (formulaDragRef.current.pageNumber !== pageNumber) return;
    event.preventDefault();

    const slot = slotsRef.current.get(pageNumber);
    const surface = slot?.surfaceEl;
    const canvas = slot?.canvasEl;
    if (!surface || !canvas) return;

    const bounds = surface.getBoundingClientRect();
    const pixelRect = toPixelRect(
      formulaDragRef.current.startX,
      formulaDragRef.current.startY,
      clampPixel(event.clientX - bounds.left, bounds.width),
      clampPixel(event.clientY - bounds.top, bounds.height),
    );
    formulaDragRef.current = null;

    if (pixelRect.width < 12 || pixelRect.height < 12) {
      setDragRect(null);
      emitStatusChange("框选区域太小，请重新选择公式");
      return;
    }

    const bbox = toNormalizedRect(pixelRect, bounds.width, bounds.height);
    setDragRect(null);
    emitFormulaAreaCapture({
      pageNumber,
      bbox,
      imageDataUrl: cropCanvasArea(canvas, pixelRect),
      sourceContext: pageTextCacheRef.current.get(pageNumber)?.slice(0, 1600),
      signature: `${pageNumber}:${bbox.x}:${bbox.y}:${bbox.width}:${bbox.height}`,
    });
  }

  function handleFormulaMouseLeave() {
    if (props.selectionMode !== "formula" || !formulaDragRef.current) return;
    setDragRect(null);
    formulaDragRef.current = null;
    emitStatusChange("已取消本次公式框选");
  }

  /* ═══════════════════════════════════════════
     Render
     ═══════════════════════════════════════════ */

  if (!props.document) {
    return (
      <section className="viewer viewer--empty">
        <div className="viewer-empty-card">
          <p className="eyebrow">Ready</p>
          <h2>打开一篇论文，开始第一轮智能阅读</h2>
          <p className="muted">这里会承载 PDF 页面渲染、文本选择、翻译预览、公式框选和高亮回显。</p>
        </div>
      </section>
    );
  }

  const numPages = pdf?.numPages ?? 0;
  const pageNumbers = numPages > 0 ? Array.from({ length: numPages }, (_, i) => i + 1) : [];

  return (
    <section className={`viewer viewer--continuous${isZooming ? " zooming" : ""}`} ref={viewerRef}>
      <div
        ref={documentRef}
        className={`viewer-stage viewer-stage--continuous${previewActive ? " zoom-previewing" : ""}`}
        style={
          previewActive
            ? {
                transform: `scale(${previewScale})`,
                transformOrigin: `${previewOriginX}px ${previewOriginY}px`,
              }
            : undefined
        }
      >
        {loading ? <div className="viewer-overlay">正在加载 PDF...</div> : null}
        {error ? <div className="viewer-overlay viewer-overlay--error">{error}</div> : null}
        {props.selectionMode === "formula" && !loading && !error ? (
          <div className="viewer-overlay">公式框选模式：拖拽选中区域，按 Esc 取消</div>
        ) : null}

        {pageNumbers.map((pageNumber) => {
          const meta = pagesMetaRef.current[pageNumber - 1];
          let slot = slotsRef.current.get(pageNumber);
          if (!slot && meta) {
            slot = createSlot(meta, layoutZoom);
            slotsRef.current.set(pageNumber, slot);
          }
          if (!slot) return null;
          const w = slot.scaledWidth;
          const h = slot.scaledHeight;
          const pageNotes = (props.notes ?? []).filter((note) => note.pageNumber === pageNumber);
          const allFormulas = props.formulas ?? [];
          const highlights = pageNotes.flatMap((note) => {
            const rects = note.rectsJson?.length
              ? note.rectsJson
              : note.formulaId
                ? allFormulas.filter((f) => f.id === note.formulaId && f.pageNumber === pageNumber).map((f) => f.bbox)
                : [];
            return deduplicateRects(rects).map((rect, idx) => ({ id: `${note.id}:${idx}`, note, rect }));
          });
          const isFocusPage = props.focusMode && focusPageNumber === pageNumber;

          return (
            <div
              key={pageNumber}
              data-page={pageNumber}
              ref={(el) => {
                slot.surfaceEl = el;
                if (el && observerRef.current) observerRef.current.observe(el);
              }}
              className={
                isZooming
                  ? props.selectionMode === "formula"
                    ? "viewer-page-surface viewer-page-surface--zooming viewer-page-surface--formula-mode"
                    : "viewer-page-surface viewer-page-surface--zooming"
                  : props.selectionMode === "formula"
                    ? "viewer-page-surface viewer-page-surface--formula-mode"
                    : "viewer-page-surface"
              }
              style={{ width: w, height: h }}
              onMouseDown={props.selectionMode === "formula" ? (e) => handleFormulaMouseDown(e, pageNumber) : undefined}
              onMouseMove={props.selectionMode === "formula" ? (e) => handleFormulaMouseMove(e, pageNumber) : undefined}
              onMouseUp={props.selectionMode === "formula" ? (e) => handleFormulaMouseUp(e, pageNumber) : undefined}
              onMouseLeave={props.selectionMode === "formula" ? handleFormulaMouseLeave : undefined}
            >
              <div ref={(el) => { slot.contentEl = el; }} className="viewer-page-content">
                <canvas ref={(el) => { slot.canvasEl = el; }} className="viewer-canvas" style={{ width: w, height: h }} />
                {isFocusPage ? (
                  <FocusModeOverlay
                    enabled
                    columnMode={props.focusColumnMode ?? "single"}
                    textLayerHostRef={{ current: slot.textLayerHostEl }}
                    viewerRef={viewerRef}
                    contextLines={5}
                  />
                ) : null}
                <div ref={(el) => { slot.textLayerHostEl = el; }} className="viewer-text-layer-host" />
                {highlights.length > 0 ? (
                  <div className="viewer-note-layer" aria-hidden="true">
                    {highlights.map(({ id, note, rect }) => {
                      const isFav = note.noteType === "formula_favorite" || note.comment === "收藏选区";
                      return (
                        <div
                          key={id}
                          className={
                            note.id === props.activeNoteId
                              ? isFav ? "viewer-note-favorite viewer-note-favorite--active" : "viewer-note-highlight viewer-note-highlight--active"
                              : isFav ? "viewer-note-favorite" : "viewer-note-highlight"
                          }
                          style={{
                            ...(isFav
                              ? { borderBottom: `2px solid ${note.color || "var(--accent)"}` }
                              : { backgroundColor: note.color ? withAlpha(note.color, 0.22) : undefined }),
                            left: `${rect.x * 100}%`,
                            top: `${rect.y * 100}%`,
                            width: `${rect.width * 100}%`,
                            height: `${rect.height * 100}%`,
                          }}
                        />
                      );
                    })}
                  </div>
                ) : null}
                {dragRect && formulaDragRef.current?.pageNumber === pageNumber ? (
                  <div
                    className="formula-selection-box"
                    style={{
                      left: `${dragRect.x}px`,
                      top: `${dragRect.y}px`,
                      width: `${dragRect.width}px`,
                      height: `${dragRect.height}px`,
                    }}
                  />
                ) : null}
              </div>
            </div>
          );
        })}

      </div>
    </section>
  );
}

/* ───────── Slot helpers ───────── */

function createSlot(meta: PageMeta, scale: number): PageSlot {
  return {
    meta,
    scaledWidth: meta.originalWidth * scale,
    scaledHeight: meta.originalHeight * scale,
    surfaceEl: null,
    contentEl: null,
    canvasEl: null,
    textLayerHostEl: null,
    renderedScale: null,
    renderingScale: null,
    renderTask: null,
    renderSettled: Promise.resolve(),
    textLayerBuilder: null,
    detachSelection: undefined,
    offscreenCanvas: null,
    pageText: null,
  };
}

/* ───────── Pure helpers ───────── */

function computeEffectiveScale(
  meta: PageMeta[],
  viewer: HTMLElement | null,
  zoom: number,
  zoomMode: "fit-width" | "manual",
): number {
  if (meta.length === 0) return clampScale(zoom);

  if (zoomMode === "fit-width" && viewer) {
    const computed = window.getComputedStyle(viewer);
    const hPad = parseFloat(computed.paddingLeft || "0") + parseFloat(computed.paddingRight || "0");
    const available = Math.max(viewer.clientWidth - hPad, 320);
    const baseWidth = meta[0].originalWidth;
    return clampScale(available / Math.max(baseWidth, 1));
  }

  return clampScale(zoom);
}

function clampScale(value: number): number {
  return Math.min(Math.max(Math.round(value * 1000) / 1000, 0.5), 5);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clampPixel(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

function withAlpha(color: string, alpha: number): string {
  const c = /^#[0-9a-fA-F]{6}$/.test(color.trim()) ? color.trim() : "#FFE58F";
  const r = Number.parseInt(c.slice(1, 3), 16);
  const g = Number.parseInt(c.slice(3, 5), 16);
  const b = Number.parseInt(c.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function normalizePdfText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSearchQuery(value: string | undefined): string {
  return normalizePdfText(value ?? "").toLocaleLowerCase();
}

function toPixelRect(startX: number, startY: number, endX: number, endY: number): PixelRect {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

function toNormalizedRect(rect: PixelRect, bw: number, bh: number): NormalizedRect {
  return {
    x: clamp01(rect.x / Math.max(bw, 1)),
    y: clamp01(rect.y / Math.max(bh, 1)),
    width: clamp01(rect.width / Math.max(bw, 1)),
    height: clamp01(rect.height / Math.max(bh, 1)),
    coordSpace: "page_normalized",
    origin: "top_left",
  };
}

function cropCanvasArea(canvas: HTMLCanvasElement, rect: PixelRect): string {
  const canvasRect = canvas.getBoundingClientRect();
  const cssW = Math.max(canvasRect.width, 1);
  const cssH = Math.max(canvasRect.height, 1);
  const sx = canvas.width / cssW;
  const sy = canvas.height / cssH;
  const srcX = Math.max(0, Math.floor(rect.x * sx));
  const srcY = Math.max(0, Math.floor(rect.y * sy));
  const srcW = Math.max(1, Math.floor(rect.width * sx));
  const srcH = Math.max(1, Math.floor(rect.height * sy));

  const out = document.createElement("canvas");
  out.width = srcW;
  out.height = srcH;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("公式截图失败");
  ctx.drawImage(canvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
  return out.toDataURL("image/png");
}

function collectSearchResults(pageText: string, query: string, pageNumber: number): ReaderSearchResult[] {
  if (!query) return [];
  const results: ReaderSearchResult[] = [];
  const lower = pageText.toLocaleLowerCase();
  let pos = 0;
  while (pos < lower.length) {
    const idx = lower.indexOf(query, pos);
    if (idx === -1) break;
    const end = idx + query.length;
    const snipStart = Math.max(0, idx - 36);
    const snipEnd = Math.min(pageText.length, end + 36);
    const snippet = pageText.slice(snipStart, snipEnd).trim();
    results.push({
      id: `${pageNumber}:${idx}:${query}`,
      pageNumber,
      matchText: pageText.slice(idx, end),
      snippet: snipStart > 0 || snipEnd < pageText.length ? `...${snippet}...` : snippet,
      startOffset: idx,
      endOffset: end,
    });
    pos = end;
  }
  return results;
}

function applySearchHighlights(textLayerDiv: HTMLDivElement, query: string | undefined) {
  const nq = normalizeSearchQuery(query);
  for (const span of Array.from(textLayerDiv.querySelectorAll("span"))) {
    const text = normalizePdfText(span.textContent ?? "").toLocaleLowerCase();
    span.classList.remove("viewer-search-hit");
    if (nq && text && text.includes(nq)) {
      span.classList.add("viewer-search-hit");
    }
  }
}

function deduplicateRects(rects: NormalizedRect[]): NormalizedRect[] {
  if (rects.length <= 1) return rects;
  const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  const result: NormalizedRect[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const prev = result[result.length - 1];
    const ox = Math.min(prev.x + prev.width, cur.x + cur.width) - Math.max(prev.x, cur.x);
    const oy = Math.min(prev.y + prev.height, cur.y + cur.height) - Math.max(prev.y, cur.y);
    if (ox > 0 && oy > 0 && ox * oy > Math.min(prev.width * prev.height, cur.width * cur.height) * 0.7) {
      if (cur.width * cur.height > prev.width * prev.height) result[result.length - 1] = cur;
      continue;
    }
    result.push(cur);
  }
  return result;
}

async function extractPageText(page: PDFPageProxy): Promise<string> {
  const tc = await page.getTextContent({ includeMarkedContent: true, disableNormalization: true });
  return normalizePdfText(tc.items.map((item) => ("str" in item ? item.str : "")).join(" "));
}

function attachTextSelectionListeners(params: {
  textLayerDiv: HTMLDivElement;
  pageNumber: number;
  pageText: string;
  onSelection: (selection: ReaderTextSelection | null) => void;
}) {
  const handleSelection = () => {
    window.setTimeout(() => params.onSelection(readSelectionFromTextLayer(params)), 0);
  };
  params.textLayerDiv.addEventListener("mouseup", handleSelection);
  params.textLayerDiv.addEventListener("keyup", handleSelection);
  return () => {
    params.textLayerDiv.removeEventListener("mouseup", handleSelection);
    params.textLayerDiv.removeEventListener("keyup", handleSelection);
  };
}

function readSelectionFromTextLayer(params: {
  textLayerDiv: HTMLDivElement;
  pageNumber: number;
  pageText: string;
}): ReaderTextSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);
  const ancestor = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement
    : range.commonAncestorContainer;

  if (!(ancestor instanceof Node) || !params.textLayerDiv.contains(ancestor)) return null;

  const selectedText = normalizePdfText(sel.toString());
  if (!selectedText) return null;

  const rectsJson = buildNormalizedRects(range, params.textLayerDiv);
  const ctx = buildSelectionContext(params.pageText, selectedText);

  return {
    pageNumber: params.pageNumber,
    selectedText,
    context: ctx.context,
    anchorJson: {
      pageNumber: params.pageNumber,
      selectedText,
      prefix: ctx.prefix,
      suffix: ctx.suffix,
      startOffset: ctx.startOffset,
      endOffset: ctx.endOffset,
    },
    rectsJson,
    signature: `${params.pageNumber}:${ctx.startOffset ?? -1}:${selectedText}`,
  };
}

function buildNormalizedRects(range: Range, textLayerDiv: HTMLDivElement): NormalizedRect[] {
  const bounds = textLayerDiv.getBoundingClientRect();
  const w = Math.max(bounds.width, 1);
  const h = Math.max(bounds.height, 1);
  return Array.from(range.getClientRects())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      x: clamp01((r.left - bounds.left) / w),
      y: clamp01((r.top - bounds.top) / h),
      width: clamp01(r.width / w),
      height: clamp01(r.height / h),
      coordSpace: "page_normalized" as const,
      origin: "top_left" as const,
    }));
}

function buildSelectionContext(pageText: string, selectedText: string) {
  const startOffset = pageText.indexOf(selectedText);
  if (startOffset === -1) {
    return { context: selectedText, prefix: undefined, suffix: undefined, startOffset: undefined, endOffset: undefined };
  }
  const endOffset = startOffset + selectedText.length;
  const prefix = pageText.slice(Math.max(0, startOffset - 120), startOffset).trim() || undefined;
  const suffix = pageText.slice(endOffset, Math.min(pageText.length, endOffset + 120)).trim() || undefined;
  return {
    context: [prefix, selectedText, suffix].filter(Boolean).join(" "),
    prefix,
    suffix,
    startOffset,
    endOffset,
  };
}
