import type {
  LaunchState,
  OpenDocumentParams,
  OpenDocumentResult,
  ReadDocumentBinaryParams,
  RecentDocumentItem,
  UpdateReadingProgressParams,
} from "@shared/types";

import { getDesktopApi } from "./desktopApi";

export const documentService = {
  getLaunchState(): Promise<LaunchState> {
    return getDesktopApi().getLaunchState();
  },

  openDocument(params: OpenDocumentParams): Promise<OpenDocumentResult> {
    return getDesktopApi().openDocument(params);
  },

  listRecentDocuments(): Promise<RecentDocumentItem[]> {
    return getDesktopApi().listRecentDocuments();
  },

  readDocumentBinary(params: ReadDocumentBinaryParams): Promise<ArrayBuffer> {
    return getDesktopApi().readDocumentBinary(params);
  },

  updateReadingProgress(params: UpdateReadingProgressParams): Promise<void> {
    return getDesktopApi().updateReadingProgress(params);
  },

  pickPdfFile() {
    return getDesktopApi().pickPdfFile();
  },
};
