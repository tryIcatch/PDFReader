import type { NormalizedRect, TextAnchor } from "@shared/types";

export type ReaderTextSelection = {
  pageNumber: number;
  selectedText: string;
  context?: string;
  anchorJson: TextAnchor;
  rectsJson: NormalizedRect[];
  signature: string;
};

export type FormulaCaptureDraft = {
  pageNumber: number;
  bbox: NormalizedRect;
  imageDataUrl: string;
  sourceContext?: string;
  signature: string;
};

export type ReaderSearchResult = {
  id: string;
  pageNumber: number;
  matchText: string;
  snippet: string;
  startOffset: number;
  endOffset: number;
};
