import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import { IPC_CHANNELS } from "../shared/ipc/channels";
import type { AppError, AppMenuAction, IpcResult, PreloadApi } from "../shared/types";

class RendererInvokeError extends Error {
  code: AppError["code"];
  retryable?: boolean;
  details?: Record<string, unknown>;

  constructor(error: AppError) {
    super(error.message);
    this.name = "RendererInvokeError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.details = error.details;
  }
}

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, payload)) as IpcResult<T>;

  if (!result.ok) {
    throw new RendererInvokeError(result.error);
  }

  return result.data;
}

const api: PreloadApi = {
  getLaunchState: () => invoke(IPC_CHANNELS.APP_GET_LAUNCH_STATE),
  openDocument: (params) => invoke(IPC_CHANNELS.DOCUMENT_OPEN, params),
  listRecentDocuments: () => invoke(IPC_CHANNELS.DOCUMENT_LIST_RECENT),
  readDocumentBinary: (params) => invoke(IPC_CHANNELS.DOCUMENT_READ_BINARY, params),
  updateReadingProgress: (params) => invoke(IPC_CHANNELS.DOCUMENT_UPDATE_PROGRESS, params),
  listLibrarySnapshot: () => invoke(IPC_CHANNELS.LIBRARY_LIST_SNAPSHOT),
  createLibraryFolder: (params) => invoke(IPC_CHANNELS.LIBRARY_CREATE_FOLDER, params),
  renameLibraryFolder: (params) => invoke(IPC_CHANNELS.LIBRARY_RENAME_FOLDER, params),
  moveDocumentToFolder: (params) => invoke(IPC_CHANNELS.LIBRARY_MOVE_DOCUMENT, params),
  translateText: (params) => invoke(IPC_CHANNELS.TRANSLATE_TEXT, params),
  recognizeFormula: (params) => invoke(IPC_CHANNELS.FORMULA_RECOGNIZE, params),
  explainFormula: (params) => invoke(IPC_CHANNELS.FORMULA_EXPLAIN, params),
  saveNote: (params) => invoke(IPC_CHANNELS.NOTE_SAVE, params),
  listNotesByDocument: (documentId) => invoke(IPC_CHANNELS.NOTE_LIST_BY_DOCUMENT, { documentId }),
  deleteNote: (noteId) => invoke(IPC_CHANNELS.NOTE_DELETE, { noteId }),
  listFormulasByDocument: (documentId) =>
    invoke(IPC_CHANNELS.FORMULA_LIST_BY_DOCUMENT, { documentId }),
  getFormulaById: (formulaId) => invoke(IPC_CHANNELS.FORMULA_GET_BY_ID, { formulaId }),
  exportMarkdown: (params) => invoke(IPC_CHANNELS.EXPORT_MARKDOWN, params),
  listHistory: (params) => invoke(IPC_CHANNELS.HISTORY_LIST, params),
  saveAiSettings: (params) => invoke(IPC_CHANNELS.SETTINGS_SAVE_AI, params),
  getAiSettings: () => invoke(IPC_CHANNELS.SETTINGS_GET_AI),
  saveMathpixSettings: (params) => invoke(IPC_CHANNELS.SETTINGS_SAVE_MATHPIX, params),
  getMathpixSettings: () => invoke(IPC_CHANNELS.SETTINGS_GET_MATHPIX),
  testMathpixSettings: (params) => invoke(IPC_CHANNELS.SETTINGS_TEST_MATHPIX, params),
  savePix2TexSettings: (params) => invoke(IPC_CHANNELS.SETTINGS_SAVE_PIX2TEX, params),
  getPix2TexSettings: () => invoke(IPC_CHANNELS.SETTINGS_GET_PIX2TEX),
  testPix2TexSettings: (params) => invoke(IPC_CHANNELS.SETTINGS_TEST_PIX2TEX, params),
  saveFormulaOcrSettings: (params) => invoke(IPC_CHANNELS.SETTINGS_SAVE_FORMULA_OCR, params),
  getFormulaOcrSettings: () => invoke(IPC_CHANNELS.SETTINGS_GET_FORMULA_OCR),
  saveThemeSettings: (params) => invoke(IPC_CHANNELS.SETTINGS_SAVE_THEME, params),
  getThemeSettings: () => invoke(IPC_CHANNELS.SETTINGS_GET_THEME),
  saveHoverTranslateSettings: (params) =>
    invoke(IPC_CHANNELS.SETTINGS_SAVE_HOVER_TRANSLATE, params),
  getHoverTranslateSettings: () => invoke(IPC_CHANNELS.SETTINGS_GET_HOVER_TRANSLATE),
  pickPdfFile: () => invoke(IPC_CHANNELS.DIALOG_PICK_PDF),
  saveFormulaImage: (params) => invoke(IPC_CHANNELS.FILE_SAVE_FORMULA_IMAGE, params),
  onAppMenuAction: (listener) => {
    const wrappedListener = (_event: IpcRendererEvent, action: AppMenuAction) => {
      listener(action);
    };

    ipcRenderer.on(IPC_CHANNELS.APP_MENU_ACTION, wrappedListener);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.APP_MENU_ACTION, wrappedListener);
    };
  },
  updateRecentDocumentsMenu: (docs) => {
    ipcRenderer.send(IPC_CHANNELS.MENU_UPDATE_RECENT_DOCUMENTS, docs);
  },
};

contextBridge.exposeInMainWorld("pdfReader", api);
