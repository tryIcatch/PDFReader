import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { TextLayerBuilder } from "pdfjs-dist/legacy/web/pdf_viewer.mjs";

import type { FormulaItem, NormalizedRect, NoteItem, OpenDocumentResult, TextAnchor } from "@shared/types";

import { documentService } from "../services/documentService";
import type {
  FormulaCaptureDraft,
  ReaderSearchResult,
  ReaderTextSelection,
} from "../types/reader";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfViewerProps = {
  document: OpenDocumentResult | null;
  pageNumber: number;
  zoom: number;
  zoomMode?: "fit-width" | "manual";
  searchQuery?: string;
  selectionMode?: "text" | "formula";
  notes?: NoteItem[];
  formulas?: FormulaItem[];
  activeNoteId?: string | null;
  autoTranslateEnabled?: boolean;
  hoveredTranslation?: string;
  isTranslatingHover?: boolean;
  onPageCountChange: (pageCount: number) => void;
  onRenderedScaleChange?: (scale: number) => void;
  onStatusChange: (status: string) => void;
  onTextSelectionChange: (selection: ReaderTextSelection | null) => void;
  onSearchResultsChange?: (results: ReaderSearchResult[]) => void;
  onZoomRequest?: (nextZoom: number) => void;
  onViewerActivity?: () => void;
  onBoundaryPageRequest?: (direction: "previous" | "next") => void;
  onFormulaAreaCapture?: (capture: FormulaCaptureDraft) => void;
  onHoverText?: (text: string, position: { x: number; y: number }) => void;
  onHoverLeave?: () => void;
};

export function PdfViewer(props: PdfViewerProps) {
  const viewerRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageSurfaceRef = useRef<HTMLDivElement | null>(null);
  const textLayerHostRef = useRef<HTMLDivElement | null>(null);
  const pageTextCacheRef = useRef<Map<number, string>>(new Map());
  const currentRenderScaleRef = useRef(1);
  const canvasRenderTaskRef = useRef<RenderTask | null>(null);
  const canvasRenderSettledRef = useRef<Promise<void>>(Promise.resolve());
  const boundaryPageTurnLockedRef = useRef(false);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageText, setPageText] = useState("");
  const [dragRect, setDragRect] = useState<PixelRect | null>(null);
  const [viewerResizeVersion, setViewerResizeVersion] = useState(0);
  const formulaDragRef = useRef<FormulaDragState | null>(null);
  const emitStatusChange = useEffectEvent((status: string) => {
    props.onStatusChange(status);
  });
  const emitTextSelectionChange = useEffectEvent((selection: ReaderTextSelection | null) => {
    props.onTextSelectionChange(selection);
  });
  const emitSearchResultsChange = useEffectEvent((results: ReaderSearchResult[]) => {
    props.onSearchResultsChange?.(results);
  });
  const emitRenderedScaleChange = useEffectEvent((scale: number) => {
    props.onRenderedScaleChange?.(scale);
  });
  const emitZoomRequest = useEffectEvent((nextZoom: number) => {
    props.onZoomRequest?.(nextZoom);
  });
  const emitViewerActivity = useEffectEvent(() => {
    props.onViewerActivity?.();
  });
  const emitBoundaryPageRequest = useEffectEvent((direction: "previous" | "next") => {
    props.onBoundaryPageRequest?.(direction);
  });
  const emitFormulaAreaCapture = useEffectEvent((capture: FormulaCaptureDraft) => {
    props.onFormulaAreaCapture?.(capture);
  });
  const emitHoverText = useEffectEvent((text: string, position: { x: number; y: number }) => {
    props.onHoverText?.(text, position);
  });
  const emitHoverLeave = useEffectEvent(() => {
    props.onHoverLeave?.();
  });

  useEffect(() => {
    let disposed = false;

    async function loadPdf() {
      if (!props.document) {
        setPdf(null);
        setError(null);
        pageTextCacheRef.current.clear();
        props.onPageCountChange(0);
        emitTextSelectionChange(null);
        emitSearchResultsChange([]);
        return;
      }

      setLoading(true);
      setError(null);
      emitStatusChange(`正在加载 ${props.document.fileName}`);

      try {
        const binary = await documentService.readDocumentBinary({
          filePath: props.document.filePath,
        });
        const loadingTask = getDocument({ data: binary });
        const loaded = await loadingTask.promise;

        if (disposed) {
          await loaded.destroy();
          return;
        }

        setPdf((previousPdf) => {
          void previousPdf?.destroy();
          return loaded;
        });
        pageTextCacheRef.current.clear();
        props.onPageCountChange(loaded.numPages);
        emitStatusChange(`已加载 ${props.document.fileName}`);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "PDF 加载失败";
        setError(message);
        setPdf(null);
        props.onPageCountChange(0);
        emitStatusChange(message);
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    }

    void loadPdf();

    return () => {
      disposed = true;
    };
  }, [props.document, props.onPageCountChange]);

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

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        let text = pageTextCacheRef.current.get(pageNumber);

        if (text === undefined) {
          const page = await pdf.getPage(pageNumber);
          text = await extractPageText(page);

          if (canceled) {
            return;
          }

          pageTextCacheRef.current.set(pageNumber, text);
        }

        results.push(...collectSearchResults(text, normalizedQuery, pageNumber));
      }

      if (!canceled) {
        emitSearchResultsChange(results);
      }
    }

    void runSearch();

    return () => {
      canceled = true;
    };
  }, [pdf, props.searchQuery, props.document?.documentId]);

  useEffect(() => {
    const viewerElement = viewerRef.current;

    if (!viewerElement || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      setViewerResizeVersion((value) => value + 1);
    });

    observer.observe(viewerElement);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const viewerElement = viewerRef.current;

    if (!viewerElement) {
      return;
    }

    viewerElement.scrollTo({
      top: 0,
      left: 0,
      behavior: "auto",
    });
  }, [props.document?.documentId, props.pageNumber]);

  useEffect(() => {
    const viewerElement = viewerRef.current;

    if (!viewerElement) {
      return;
    }

    const handleViewerActivity = () => {
      emitViewerActivity();
    };

    viewerElement.addEventListener("scroll", handleViewerActivity, { passive: true });

    return () => {
      viewerElement.removeEventListener("scroll", handleViewerActivity);
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    let textLayerBuilder: TextLayerBuilder | null = null;
    let detachSelectionListeners: (() => void) | undefined;

    async function renderPage() {
      if (!pdf || !canvasRef.current || !pageSurfaceRef.current || !textLayerHostRef.current) {
        return;
      }

      setError(null);
      emitTextSelectionChange(null);

      try {
        const safePageNumber = Math.min(Math.max(props.pageNumber, 1), pdf.numPages);
        const page = await pdf.getPage(safePageNumber);
        const extractedPageText = await extractPageText(page);
        const renderScale = getRenderScale(
          page,
          viewerRef.current,
          props.zoom,
          props.zoomMode ?? "fit-width",
        );
        const viewport = await renderCanvas(
          page,
          canvasRef.current,
          renderScale,
          canvasRenderTaskRef,
          canvasRenderSettledRef,
          () => canceled,
        );

        if (canceled) {
          return;
        }

        setPageText(extractedPageText);
        pageTextCacheRef.current.set(safePageNumber, extractedPageText);
        currentRenderScaleRef.current = renderScale;
        emitRenderedScaleChange(renderScale);

        pageSurfaceRef.current.style.width = `${viewport.width}px`;
        pageSurfaceRef.current.style.height = `${viewport.height}px`;
        pageSurfaceRef.current.style.setProperty("--scale-factor", String(viewport.scale));
        textLayerHostRef.current.style.setProperty("--scale-factor", String(viewport.scale));

        textLayerHostRef.current.replaceChildren();
        textLayerBuilder = new TextLayerBuilder({
          pdfPage: page,
        });
        await textLayerBuilder.render(viewport);

        if (canceled) {
          textLayerBuilder.cancel();
          return;
        }

        textLayerBuilder.div.style.setProperty("--scale-factor", String(viewport.scale));
        textLayerHostRef.current.append(textLayerBuilder.div);
        applySearchHighlights(textLayerBuilder.div, props.searchQuery);
        detachSelectionListeners = attachTextSelectionListeners({
          textLayerDiv: textLayerBuilder.div,
          pageNumber: safePageNumber,
          pageText: extractedPageText,
          onSelection: (selection) => {
            if (props.selectionMode === "formula") {
              return;
            }

            emitTextSelectionChange(selection);

            if (selection) {
              emitStatusChange(
                `已选中第 ${selection.pageNumber} 页文本，正在准备翻译`,
              );
            } else {
              emitStatusChange(`第 ${safePageNumber} 页 · ${Math.round(renderScale * 100)}%`);
            }
          },
        });

        emitStatusChange(`第 ${safePageNumber} 页 · ${Math.round(renderScale * 100)}%`);
      } catch (cause) {
        if (!canceled) {
          const message = cause instanceof Error ? cause.message : "页面渲染失败";
          setError(message);
          emitStatusChange(message);
        }
      }
    }

    void renderPage();

    return () => {
      canceled = true;
      detachSelectionListeners?.();
      cancelCanvasRender(canvasRenderTaskRef);
      textLayerBuilder?.cancel();
      textLayerHostRef.current?.replaceChildren();
      setDragRect(null);
      formulaDragRef.current = null;
    };
  }, [pdf, props.pageNumber, props.zoom, props.zoomMode, props.selectionMode, viewerResizeVersion]);

  useEffect(() => {
    const textLayerDiv = textLayerHostRef.current?.querySelector(".textLayer");

    if (!(textLayerDiv instanceof HTMLDivElement)) {
      return;
    }

    applySearchHighlights(textLayerDiv, props.searchQuery);
  }, [props.searchQuery, props.pageNumber, props.zoom]);

  const hoverTimerRef = useRef<number | null>(null);
  const lastHoveredKeyRef = useRef<string>("");

  useEffect(() => {
    const viewer = viewerRef.current;

    if (!viewer || !props.autoTranslateEnabled || props.selectionMode === "formula") {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const textLayerHost = textLayerHostRef.current;
      if (!textLayerHost) {
        return;
      }

      const elements = document.elementsFromPoint(event.clientX, event.clientY);
      const span = elements.find(
        (el) => el.tagName === "SPAN" && textLayerHost.contains(el),
      ) as HTMLElement | undefined;

      if (!span) {
        if (hoverTimerRef.current !== null) {
          window.clearTimeout(hoverTimerRef.current);
          hoverTimerRef.current = null;
        }

        if (lastHoveredKeyRef.current) {
          lastHoveredKeyRef.current = "";
          emitHoverLeave();
        }

        return;
      }

      const text = getSpanLineText(span);

      if (!text) {
        return;
      }

      const hoverKey = `${text}|${event.clientX.toFixed(0)}|${event.clientY.toFixed(0)}`;

      if (hoverKey === lastHoveredKeyRef.current) {
        return;
      }

      lastHoveredKeyRef.current = hoverKey;

      const clientX = event.clientX;
      const clientY = event.clientY;

      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
      }

      hoverTimerRef.current = window.setTimeout(() => {
        hoverTimerRef.current = null;

        if (lastHoveredKeyRef.current === hoverKey) {
          emitHoverText(text, { x: clientX, y: clientY });
        }
      }, 400);
    };

    const handleMouseLeave = () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }

      lastHoveredKeyRef.current = "";
      emitHoverLeave();
    };

    viewer.addEventListener("mousemove", handleMouseMove);
    viewer.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      viewer.removeEventListener("mousemove", handleMouseMove);
      viewer.removeEventListener("mouseleave", handleMouseLeave);

      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }

      lastHoveredKeyRef.current = "";
    };
  }, [props.autoTranslateEnabled, props.pageNumber, props.zoom, props.selectionMode, props.document]);

  useEffect(() => {
    if (!props.activeNoteId) {
      return;
    }

    window.setTimeout(() => {
      const viewerElement = viewerRef.current;
      const pageSurface = pageSurfaceRef.current;
      const highlightElement = pageSurface?.querySelector(".viewer-note-highlight--active");

      if (!(viewerElement instanceof HTMLElement) || !(highlightElement instanceof HTMLElement)) {
        return;
      }

      const highlightTop = highlightElement.offsetTop;
      const highlightLeft = highlightElement.offsetLeft;
      viewerElement.scrollTo({
        top: Math.max(highlightTop - viewerElement.clientHeight * 0.35, 0),
        left: Math.max(highlightLeft - viewerElement.clientWidth * 0.2, 0),
        behavior: "smooth",
      });
    }, 80);
  }, [props.activeNoteId, props.pageNumber, props.zoom, props.notes]);

  useEffect(() => {
    if (props.selectionMode !== "formula") {
      setDragRect(null);
      formulaDragRef.current = null;
    }
  }, [props.selectionMode]);

  useEffect(() => {
    const viewerElement = viewerRef.current;

    if (!viewerElement) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      const target = event.target;

      if (!props.document || !(target instanceof Node) || !viewerElement.contains(target)) {
        return;
      }

      if (!event.ctrlKey) {
        if (tryTurnPageAtScrollBoundary(viewerElement, event, props.pageNumber, pdf?.numPages ?? 0)) {
          event.preventDefault();
          event.stopPropagation();
        }

        return;
      }

      event.preventDefault();
      event.stopPropagation();
      emitViewerActivity();

      const currentScale = currentRenderScaleRef.current;
      const step = event.deltaY < 0 ? 0.1 : -0.1;
      const nextZoom = clampZoomLevel(currentScale + step);

      if (nextZoom === currentScale) {
        return;
      }

      emitZoomRequest(nextZoom);
      emitStatusChange(`缩放 ${Math.round(nextZoom * 100)}%`);
    };

    const tryTurnPageAtScrollBoundary = (
      element: HTMLElement,
      event: WheelEvent,
      pageNumber: number,
      totalPages: number,
    ) => {
      if (boundaryPageTurnLockedRef.current || Math.abs(event.deltaY) < 8) {
        return false;
      }

      const boundaryThreshold = 2;
      const atTop = element.scrollTop <= boundaryThreshold;
      const atBottom =
        element.scrollTop + element.clientHeight >= element.scrollHeight - boundaryThreshold;
      const direction =
        event.deltaY > 0 && atBottom && pageNumber < totalPages
          ? "next"
          : event.deltaY < 0 && atTop && pageNumber > 1
            ? "previous"
            : null;

      if (!direction) {
        return false;
      }

      boundaryPageTurnLockedRef.current = true;
      window.setTimeout(() => {
        boundaryPageTurnLockedRef.current = false;
      }, 520);

      emitViewerActivity();
      emitBoundaryPageRequest(direction);
      return true;
    };

    window.addEventListener("wheel", handleWheel, {
      passive: false,
      capture: true,
    });

    return () => {
      window.removeEventListener("wheel", handleWheel, {
        capture: true,
      });
    };
  }, [props.document, props.zoom, props.zoomMode, props.pageNumber, pdf]);

  useEffect(() => {
    if (props.selectionMode !== "formula") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDragRect(null);
        formulaDragRef.current = null;
        emitStatusChange("已退出本次公式框选");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [props.selectionMode]);

  useEffect(() => {
    return () => {
      cancelCanvasRender(canvasRenderTaskRef);
      void pdf?.destroy();
    };
  }, [pdf]);

  if (!props.document) {
    return (
      <section className="viewer viewer--empty">
        <div className="viewer-empty-card">
          <p className="eyebrow">Ready</p>
          <h2>打开一篇论文，开始第一轮智能阅读</h2>
          <p className="muted">
            这里会承载 PDF 页面渲染、文本选择、翻译预览、公式框选和后续的高亮回显。
          </p>
        </div>
      </section>
    );
  }

  const currentPageHighlights = (props.notes ?? []).flatMap((note) => {
    if (note.pageNumber !== props.pageNumber) {
      return [];
    }

    const rects =
      note.rectsJson?.length
        ? note.rectsJson
        : note.formulaId
          ? props.formulas
              ?.filter((formula) => formula.id === note.formulaId && formula.pageNumber === props.pageNumber)
              .map((formula) => formula.bbox) ?? []
          : [];

    return rects.map((rect, index) => ({
      id: `${note.id}:${index}`,
      note,
      rect,
    }));
  });

  return (
    <section className="viewer" ref={viewerRef}>
      <div className="viewer-stage">
        {loading ? <div className="viewer-overlay">正在加载 PDF…</div> : null}
        {error ? <div className="viewer-overlay viewer-overlay--error">{error}</div> : null}
        {props.selectionMode === "formula" && !loading && !error ? (
          <div className="viewer-overlay">公式框选模式：拖拽选中区域，按 Esc 取消</div>
        ) : null}
        <div
          ref={pageSurfaceRef}
          className={
            props.selectionMode === "formula"
              ? "viewer-page-surface viewer-page-surface--formula-mode"
              : "viewer-page-surface"
          }
          onMouseDown={handleFormulaMouseDown}
          onMouseMove={handleFormulaMouseMove}
          onMouseUp={handleFormulaMouseUp}
          onMouseLeave={handleFormulaMouseLeave}
        >
          <canvas ref={canvasRef} className="viewer-canvas" />
          <div ref={textLayerHostRef} className="viewer-text-layer-host" />
          {currentPageHighlights.length > 0 ? (
            <div className="viewer-note-layer" aria-hidden="true">
              {currentPageHighlights.map(({ id, note, rect }) => (
                <div
                  key={id}
                  className={
                    note.id === props.activeNoteId
                      ? "viewer-note-highlight viewer-note-highlight--active"
                      : "viewer-note-highlight"
                  }
                  style={{
                    backgroundColor: note.color ? withAlpha(note.color, 0.36) : undefined,
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.width * 100}%`,
                    height: `${rect.height * 100}%`,
                  }}
                />
              ))}
            </div>
          ) : null}
          {dragRect ? (
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
    </section>
  );

  function handleFormulaMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (
      props.selectionMode !== "formula" ||
      !pageSurfaceRef.current ||
      event.button !== 0
    ) {
      return;
    }

    event.preventDefault();
    const bounds = pageSurfaceRef.current.getBoundingClientRect();
    const startX = clampPixel(event.clientX - bounds.left, bounds.width);
    const startY = clampPixel(event.clientY - bounds.top, bounds.height);

    formulaDragRef.current = {
      startX,
      startY,
      boundsWidth: bounds.width,
      boundsHeight: bounds.height,
    };
    setDragRect({ x: startX, y: startY, width: 0, height: 0 });
    emitStatusChange("正在框选公式区域…");
  }

  function handleFormulaMouseMove(event: ReactMouseEvent<HTMLDivElement>) {
    if (props.selectionMode !== "formula" || !pageSurfaceRef.current || !formulaDragRef.current) {
      return;
    }

    event.preventDefault();
    const bounds = pageSurfaceRef.current.getBoundingClientRect();
    const currentX = clampPixel(event.clientX - bounds.left, bounds.width);
    const currentY = clampPixel(event.clientY - bounds.top, bounds.height);
    setDragRect(toPixelRect(formulaDragRef.current.startX, formulaDragRef.current.startY, currentX, currentY));
  }

  function handleFormulaMouseUp(event: ReactMouseEvent<HTMLDivElement>) {
    if (
      props.selectionMode !== "formula" ||
      !pageSurfaceRef.current ||
      !canvasRef.current ||
      !formulaDragRef.current
    ) {
      return;
    }

    event.preventDefault();
    const bounds = pageSurfaceRef.current.getBoundingClientRect();
    const endX = clampPixel(event.clientX - bounds.left, bounds.width);
    const endY = clampPixel(event.clientY - bounds.top, bounds.height);
    const pixelRect = toPixelRect(formulaDragRef.current.startX, formulaDragRef.current.startY, endX, endY);

    formulaDragRef.current = null;

    if (pixelRect.width < 12 || pixelRect.height < 12) {
      setDragRect(null);
      emitStatusChange("框选区域太小，请重新选择公式");
      return;
    }

    setDragRect(null);
    const normalizedBbox = toNormalizedRect(pixelRect, bounds.width, bounds.height);
    const imageDataUrl = cropCanvasArea(canvasRef.current, pixelRect);
    const sourceContext = pageText ? pageText.slice(0, 1600) : undefined;

    emitFormulaAreaCapture({
      pageNumber: props.pageNumber,
      bbox: normalizedBbox,
      imageDataUrl,
      sourceContext,
      signature: `${props.pageNumber}:${normalizedBbox.x}:${normalizedBbox.y}:${normalizedBbox.width}:${normalizedBbox.height}`,
    });
  }

  function handleFormulaMouseLeave() {
    if (props.selectionMode !== "formula" || !formulaDragRef.current) {
      return;
    }

    setDragRect(null);
    formulaDragRef.current = null;
    emitStatusChange("已取消本次公式框选");
  }

}

async function renderCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  zoom: number,
  renderTaskRef: { current: RenderTask | null },
  renderSettledRef: { current: Promise<void> },
  isCanceled: () => boolean,
) {
  cancelCanvasRender(renderTaskRef);
  await renderSettledRef.current;

  if (isCanceled()) {
    throw new Error("Render canceled");
  }

  const viewport = page.getViewport({ scale: Math.max(zoom, 0.4) });
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas context 初始化失败");
  }

  const outputScale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const renderTask = page.render({
    canvasContext: context,
    viewport,
    transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
  });

  renderTaskRef.current = renderTask;
  renderSettledRef.current = renderTask.promise
    .catch(() => undefined)
    .finally(() => {
      if (renderTaskRef.current === renderTask) {
        renderTaskRef.current = null;
      }
    });

  await renderTask.promise;

  return viewport;
}

function cancelCanvasRender(renderTaskRef: { current: RenderTask | null }) {
  const renderTask = renderTaskRef.current;

  if (!renderTask) {
    return;
  }

  try {
    renderTask.cancel();
  } catch {
    // The task may have completed between the ref check and cancellation.
  }
  renderTaskRef.current = null;
}

async function extractPageText(page: PDFPageProxy): Promise<string> {
  const textContent = await page.getTextContent({
    includeMarkedContent: true,
    disableNormalization: true,
  });

  return normalizePdfText(
    textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" "),
  );
}

function attachTextSelectionListeners(params: {
  textLayerDiv: HTMLDivElement;
  pageNumber: number;
  pageText: string;
  onSelection: (selection: ReaderTextSelection | null) => void;
}) {
  const handleSelection = () => {
    window.setTimeout(() => {
      params.onSelection(readSelectionFromTextLayer(params));
    }, 0);
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
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const commonNode =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;

  if (!(commonNode instanceof Node) || !params.textLayerDiv.contains(commonNode)) {
    return null;
  }

  const selectedText = normalizePdfText(selection.toString());

  if (!selectedText) {
    return null;
  }

  const rectsJson = buildNormalizedRects(range, params.textLayerDiv);
  const contextData = buildSelectionContext(params.pageText, selectedText);
  const anchorJson: TextAnchor = {
    pageNumber: params.pageNumber,
    selectedText,
    prefix: contextData.prefix,
    suffix: contextData.suffix,
    startOffset: contextData.startOffset,
    endOffset: contextData.endOffset,
  };

  return {
    pageNumber: params.pageNumber,
    selectedText,
    context: contextData.context,
    anchorJson,
    rectsJson,
    signature: `${params.pageNumber}:${contextData.startOffset ?? -1}:${selectedText}`,
  };
}

function buildNormalizedRects(range: Range, textLayerDiv: HTMLDivElement): NormalizedRect[] {
  const layerBounds = textLayerDiv.getBoundingClientRect();
  const width = Math.max(layerBounds.width, 1);
  const height = Math.max(layerBounds.height, 1);

  return Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      x: clamp((rect.left - layerBounds.left) / width),
      y: clamp((rect.top - layerBounds.top) / height),
      width: clamp(rect.width / width),
      height: clamp(rect.height / height),
      coordSpace: "page_normalized",
      origin: "top_left",
    }));
}

function buildSelectionContext(pageText: string, selectedText: string) {
  const startOffset = pageText.indexOf(selectedText);

  if (startOffset === -1) {
    return {
      context: selectedText,
      prefix: undefined,
      suffix: undefined,
      startOffset: undefined,
      endOffset: undefined,
    };
  }

  const endOffset = startOffset + selectedText.length;
  const prefix = pageText.slice(Math.max(0, startOffset - 120), startOffset).trim() || undefined;
  const suffix =
    pageText.slice(endOffset, Math.min(pageText.length, endOffset + 120)).trim() || undefined;
  const context = [prefix, selectedText, suffix].filter(Boolean).join(" ");

  return {
    context,
    prefix,
    suffix,
    startOffset,
    endOffset,
  };
}

function normalizePdfText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSearchQuery(value: string | undefined): string {
  return normalizePdfText(value ?? "").toLocaleLowerCase();
}

function clamp(value: number): number {
  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function withAlpha(color: string, alpha: number): string {
  const normalizedColor = /^#[0-9a-fA-F]{6}$/.test(color.trim()) ? color.trim() : "#FFE58F";
  const r = Number.parseInt(normalizedColor.slice(1, 3), 16);
  const g = Number.parseInt(normalizedColor.slice(3, 5), 16);
  const b = Number.parseInt(normalizedColor.slice(5, 7), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clampZoomLevel(value: number): number {
  const normalizedValue = Math.round(value * 100) / 100;
  return Math.min(Math.max(normalizedValue, 0.5), 4);
}

function getRenderScale(
  page: PDFPageProxy,
  viewerElement: HTMLElement | null,
  zoomValue: number,
  zoomMode: "fit-width" | "manual",
): number {
  const baseViewport = page.getViewport({ scale: 1 });

  if (!viewerElement) {
    return clampRenderScale(zoomValue);
  }

  const computedStyle = window.getComputedStyle(viewerElement);
  const horizontalPadding =
    parseFloat(computedStyle.paddingLeft || "0") + parseFloat(computedStyle.paddingRight || "0");
  const availableWidth = Math.max(viewerElement.clientWidth - horizontalPadding, 320);
  const fitScale = availableWidth / Math.max(baseViewport.width, 1);

  if (zoomMode === "fit-width") {
    return clampRenderScale(fitScale);
  }

  return clampRenderScale(zoomValue);
}

function clampRenderScale(value: number): number {
  return Math.min(Math.max(value, 0.3), 4);
}

function collectSearchResults(
  pageText: string,
  normalizedQuery: string,
  pageNumber: number,
): ReaderSearchResult[] {
  if (!normalizedQuery) {
    return [];
  }

  const results: ReaderSearchResult[] = [];
  const normalizedText = pageText.toLocaleLowerCase();
  let searchStart = 0;

  while (searchStart < normalizedText.length) {
    const matchStart = normalizedText.indexOf(normalizedQuery, searchStart);

    if (matchStart === -1) {
      break;
    }

    const matchEnd = matchStart + normalizedQuery.length;
    const snippetStart = Math.max(0, matchStart - 36);
    const snippetEnd = Math.min(pageText.length, matchEnd + 36);
    const snippet = pageText.slice(snippetStart, snippetEnd).trim();

    results.push({
      id: `${pageNumber}:${matchStart}:${normalizedQuery}`,
      pageNumber,
      matchText: pageText.slice(matchStart, matchEnd),
      snippet:
        snippetStart > 0 || snippetEnd < pageText.length ? `…${snippet}…` : snippet,
      startOffset: matchStart,
      endOffset: matchEnd,
    });

    searchStart = matchStart + normalizedQuery.length;
  }

  return results;
}

function applySearchHighlights(textLayerDiv: HTMLDivElement, searchQuery: string | undefined) {
  const normalizedQuery = normalizeSearchQuery(searchQuery);
  const spans = Array.from(textLayerDiv.querySelectorAll("span"));

  for (const span of spans) {
    const text = normalizePdfText(span.textContent ?? "").toLocaleLowerCase();
    span.classList.remove("viewer-search-hit");

    if (!normalizedQuery || !text) {
      continue;
    }

    if (text.includes(normalizedQuery)) {
      span.classList.add("viewer-search-hit");
    }
  }
}

type PixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type FormulaDragState = {
  startX: number;
  startY: number;
  boundsWidth: number;
  boundsHeight: number;
};

function clampPixel(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

function toPixelRect(startX: number, startY: number, endX: number, endY: number): PixelRect {
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);

  return {
    x,
    y,
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

function toNormalizedRect(rect: PixelRect, boundsWidth: number, boundsHeight: number): NormalizedRect {
  return {
    x: clamp(rect.x / Math.max(boundsWidth, 1)),
    y: clamp(rect.y / Math.max(boundsHeight, 1)),
    width: clamp(rect.width / Math.max(boundsWidth, 1)),
    height: clamp(rect.height / Math.max(boundsHeight, 1)),
    coordSpace: "page_normalized",
    origin: "top_left",
  };
}

function cropCanvasArea(canvas: HTMLCanvasElement, rect: PixelRect): string {
  const cssWidth = canvas.clientWidth || parseFloat(canvas.style.width) || 1;
  const cssHeight = canvas.clientHeight || parseFloat(canvas.style.height) || 1;
  const scaleX = canvas.width / cssWidth;
  const scaleY = canvas.height / cssHeight;
  const sourceX = Math.max(0, Math.floor(rect.x * scaleX));
  const sourceY = Math.max(0, Math.floor(rect.y * scaleY));
  const sourceWidth = Math.max(1, Math.floor(rect.width * scaleX));
  const sourceHeight = Math.max(1, Math.floor(rect.height * scaleY));

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = sourceWidth;
  outputCanvas.height = sourceHeight;
  const context = outputCanvas.getContext("2d");

  if (!context) {
    throw new Error("公式截图失败：无法创建临时画布");
  }

  context.drawImage(
    canvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );

  return outputCanvas.toDataURL("image/png");
}

function getSpanLineText(span: HTMLElement): string {
  const parent = span.parentElement;
  if (!parent) {
    return normalizePdfText(span.textContent ?? "");
  }

  const spanRect = span.getBoundingClientRect();
  const lineTop = spanRect.top;
  const tolerance = Math.max(spanRect.height * 0.5, 2);

  const allSpans = parent.querySelectorAll<HTMLElement>("span");
  const lineSpans: Array<{ left: number; text: string }> = [];

  for (const s of allSpans) {
    const rect = s.getBoundingClientRect();
    if (Math.abs(rect.top - lineTop) <= tolerance) {
      lineSpans.push({ left: rect.left, text: s.textContent ?? "" });
    }
  }

  if (lineSpans.length === 0) {
    return normalizePdfText(span.textContent ?? "");
  }

  lineSpans.sort((a, b) => a.left - b.left);
  return normalizePdfText(lineSpans.map((item) => item.text).join(""));
}
