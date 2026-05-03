import { contextBridge, ipcRenderer } from "electron";
const IPC_CHANNELS = {
  APP_GET_LAUNCH_STATE: "app:get-launch-state",
  DOCUMENT_OPEN: "document:open",
  DOCUMENT_LIST_RECENT: "document:list-recent",
  DOCUMENT_READ_BINARY: "document:read-binary",
  DOCUMENT_UPDATE_PROGRESS: "document:update-progress",
  LIBRARY_LIST_SNAPSHOT: "library:list-snapshot",
  LIBRARY_CREATE_FOLDER: "library:create-folder",
  LIBRARY_RENAME_FOLDER: "library:rename-folder",
  LIBRARY_MOVE_DOCUMENT: "library:move-document",
  TRANSLATE_TEXT: "translate:text",
  FORMULA_RECOGNIZE: "formula:recognize",
  FORMULA_EXPLAIN: "formula:explain",
  FORMULA_LIST_BY_DOCUMENT: "formula:list-by-document",
  FORMULA_GET_BY_ID: "formula:get-by-id",
  NOTE_SAVE: "note:save",
  NOTE_LIST_BY_DOCUMENT: "note:list-by-document",
  NOTE_DELETE: "note:delete",
  EXPORT_MARKDOWN: "export:markdown",
  HISTORY_LIST: "history:list",
  SETTINGS_SAVE_AI: "settings:save-ai",
  SETTINGS_GET_AI: "settings:get-ai",
  SETTINGS_SAVE_MATHPIX: "settings:save-mathpix",
  SETTINGS_GET_MATHPIX: "settings:get-mathpix",
  SETTINGS_TEST_MATHPIX: "settings:test-mathpix",
  SETTINGS_SAVE_PIX2TEX: "settings:save-pix2tex",
  SETTINGS_GET_PIX2TEX: "settings:get-pix2tex",
  SETTINGS_TEST_PIX2TEX: "settings:test-pix2tex",
  SETTINGS_SAVE_FORMULA_OCR: "settings:save-formula-ocr",
  SETTINGS_GET_FORMULA_OCR: "settings:get-formula-ocr",
  SETTINGS_SAVE_HOVER_TRANSLATE: "settings:save-hover-translate",
  SETTINGS_GET_HOVER_TRANSLATE: "settings:get-hover-translate",
  SETTINGS_SAVE_THEME: "settings:save-theme",
  SETTINGS_GET_THEME: "settings:get-theme",
  DIALOG_PICK_PDF: "dialog:pick-pdf",
  FILE_SAVE_FORMULA_IMAGE: "file:save-formula-image",
  APP_MENU_ACTION: "app:menu-action",
  MENU_UPDATE_RECENT_DOCUMENTS: "menu:update-recent-documents"
};
class RendererInvokeError extends Error {
  code;
  retryable;
  details;
  constructor(error) {
    super(error.message);
    this.name = "RendererInvokeError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.details = error.details;
  }
}
async function invoke(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload);
  if (!result.ok) {
    throw new RendererInvokeError(result.error);
  }
  return result.data;
}
const api = {
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
  listFormulasByDocument: (documentId) => invoke(IPC_CHANNELS.FORMULA_LIST_BY_DOCUMENT, { documentId }),
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
  saveHoverTranslateSettings: (params) => invoke(IPC_CHANNELS.SETTINGS_SAVE_HOVER_TRANSLATE, params),
  getHoverTranslateSettings: () => invoke(IPC_CHANNELS.SETTINGS_GET_HOVER_TRANSLATE),
  pickPdfFile: () => invoke(IPC_CHANNELS.DIALOG_PICK_PDF),
  saveFormulaImage: (params) => invoke(IPC_CHANNELS.FILE_SAVE_FORMULA_IMAGE, params),
  onAppMenuAction: (listener) => {
    const wrappedListener = (_event, action) => {
      listener(action);
    };
    ipcRenderer.on(IPC_CHANNELS.APP_MENU_ACTION, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.APP_MENU_ACTION, wrappedListener);
    };
  },
  updateRecentDocumentsMenu: (docs) => {
    ipcRenderer.send(IPC_CHANNELS.MENU_UPDATE_RECENT_DOCUMENTS, docs);
  }
};
contextBridge.exposeInMainWorld("pdfReader", api);
