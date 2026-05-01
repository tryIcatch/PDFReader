export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export type AppErrorCode =
  | "INVALID_PARAMS"
  | "NOT_FOUND"
  | "PDF_LOAD_FAILED"
  | "PDF_TEXT_UNAVAILABLE"
  | "AI_REQUEST_FAILED"
  | "MATHPIX_REQUEST_FAILED"
  | "LOCAL_OCR_FAILED"
  | "DB_ERROR"
  | "EXPORT_FAILED"
  | "UNAUTHORIZED"
  | "UNKNOWN_ERROR";

export type AppError = {
  code: AppErrorCode;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  coordSpace: "page_normalized";
  origin: "top_left";
};

export type NoteType = "highlight" | "comment" | "formula_favorite";

export type HistoryActionType =
  | "translate_text"
  | "recognize_formula"
  | "explain_formula"
  | "save_note"
  | "export_markdown";

export type SaveAiSettingsParams = {
  baseURL: string;
  apiKey?: string;
  model: string;
};

export type AiSettingsView = {
  baseURL: string;
  model: string;
  configured: boolean;
};

export type SaveMathpixSettingsParams = {
  appId: string;
  appKey?: string;
};

export type FormulaOcrProvider = "mathpix" | "pix2tex";

export type ProviderHealthCheckResult = {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
};

export type MathpixSettingsView = {
  appId: string;
  configured: boolean;
};

export type SavePix2TexSettingsParams = {
  pythonPath: string;
};

export type Pix2TexSettingsView = {
  pythonPath: string;
  configured: boolean;
};

export type SaveFormulaOcrSettingsParams = {
  provider: FormulaOcrProvider;
};

export type FormulaOcrSettingsView = {
  provider: FormulaOcrProvider;
};

export type ThemeSettingsView = {
  accentColor: string;
};

export type SaveThemeSettingsParams = {
  accentColor: string;
};

export type TestMathpixSettingsParams = {
  appId: string;
  appKey?: string;
};

export type TestPix2TexSettingsParams = {
  pythonPath: string;
};

export type AutoTranslateSettingsView = {
  enabled: boolean;
};

export type ReaderPreferences = {
  defaultZoom?: number;
  sidebarVisible?: boolean;
  aiPanelVisible?: boolean;
};

export type ExportPreferences = {
  includeOriginal: boolean;
  includeTranslation: boolean;
  includeLatex: boolean;
  includeExplanation: boolean;
};

export type OpenDocumentParams = {
  filePath: string;
  libraryFolderId?: string | null;
};

export type OpenDocumentResult = {
  documentId: string;
  fileName: string;
  filePath: string;
  pageCount: number;
  libraryFolderId?: string | null;
  lastPage?: number;
  lastZoom?: number;
};

export type RecentDocumentItem = {
  documentId: string;
  fileName: string;
  filePath: string;
  pageCount: number;
  libraryFolderId?: string | null;
  lastOpenTime: string;
  lastPage: number;
  lastZoom: number;
};

export type LaunchState =
  | {
      mode: "resume";
      document: OpenDocumentResult;
    }
  | {
      mode: "library";
      reason: "first_launch" | "no_recent_document" | "missing_recent_document";
      missingFileName?: string;
    };

export type LibraryFolderItem = {
  id: string;
  parentId?: string | null;
  name: string;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
};

export type LibraryDocumentItem = {
  documentId: string;
  fileName: string;
  filePath: string;
  pageCount: number;
  libraryFolderId?: string | null;
  lastOpenTime?: string;
  lastPage?: number;
  lastZoom?: number;
};

export type LibrarySnapshot = {
  folders: LibraryFolderItem[];
  documents: LibraryDocumentItem[];
};

export type CreateLibraryFolderParams = {
  name: string;
  parentId?: string | null;
};

export type RenameLibraryFolderParams = {
  folderId: string;
  name: string;
};

export type MoveDocumentToFolderParams = {
  documentId: string;
  folderId?: string | null;
};

export type ReadDocumentBinaryParams = {
  filePath: string;
};

export type UpdateReadingProgressParams = {
  documentId: string;
  lastPage: number;
  lastZoom: number;
  scrollTopRatio?: number;
};

export type TranslateTextParams = {
  documentId: string;
  pageNumber: number;
  text: string;
  targetLang: string;
  context?: string;
};

export type TranslateTextResult = {
  translatedText: string;
  cached: boolean;
  model: string;
};

export type FormulaVariable = {
  symbol: string;
  meaning: string;
};

export type RecognizeFormulaParams = {
  documentId: string;
  pageNumber: number;
  bbox: NormalizedRect;
  imagePath: string;
  sourceContext?: string;
};

export type RecognizeFormulaResult = {
  formulaId: string;
  latex: string;
  confidence?: number;
  ocrProvider: FormulaOcrProvider;
};

export type ExplainFormulaParams = {
  formulaId: string;
  latex: string;
  context?: string;
};

export type ExplainFormulaResult = {
  explanation: string;
  variables: FormulaVariable[];
};

export type TextAnchor = {
  pageNumber: number;
  selectedText: string;
  prefix?: string;
  suffix?: string;
  startOffset?: number;
  endOffset?: number;
};

export type SaveNoteParams = {
  documentId: string;
  pageNumber: number;
  noteType: NoteType;
  selectedText?: string;
  translatedText?: string;
  comment?: string;
  color?: string;
  anchorJson?: TextAnchor;
  rectsJson?: NormalizedRect[];
  formulaId?: string;
};

export type SaveNoteResult = {
  noteId: string;
};

export type NoteItem = {
  id: string;
  documentId: string;
  pageNumber: number;
  noteType: NoteType;
  selectedText?: string;
  translatedText?: string;
  comment?: string;
  color?: string;
  anchorJson?: TextAnchor;
  rectsJson?: NormalizedRect[];
  formulaId?: string;
  createdAt: string;
  updatedAt: string;
};

export type FormulaItem = {
  id: string;
  documentId: string;
  pageNumber: number;
  bbox: NormalizedRect;
  imagePath: string;
  latex?: string;
  explanation?: string;
  variables?: FormulaVariable[];
  confidence?: number;
  ocrProvider: FormulaOcrProvider;
  sourceContext?: string;
  createdAt: string;
  updatedAt?: string;
};

export type ExportMarkdownParams = {
  documentId: string;
  includeOriginal: boolean;
  includeTranslation: boolean;
  includeLatex: boolean;
  includeExplanation: boolean;
  outputPath?: string;
};

export type ExportMarkdownResult = {
  outputPath: string;
  noteCount: number;
  formulaCount: number;
};

export type HistoryItem = {
  id: string;
  documentId?: string;
  actionType: HistoryActionType;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type ListHistoryParams = {
  documentId?: string;
  actionType?: HistoryActionType;
  limit?: number;
};

export type PickPdfFileResult = {
  canceled: boolean;
  filePath?: string;
};

export type SaveFormulaImageParams = {
  documentId: string;
  pageNumber: number;
  imageDataUrl: string;
};

export type SaveFormulaImageResult = {
  imagePath: string;
};

export type AppMenuAction =
  | "open_library"
  | "open_file"
  | "open_settings"
  | "toggle_search"
  | "toggle_sidebar"
  | "toggle_ai_panel"
  | "reset_zoom"
  | "previous_page"
  | "next_page";

export type PreloadApi = {
  getLaunchState(): Promise<LaunchState>;
  openDocument(params: OpenDocumentParams): Promise<OpenDocumentResult>;
  listRecentDocuments(): Promise<RecentDocumentItem[]>;
  readDocumentBinary(params: ReadDocumentBinaryParams): Promise<ArrayBuffer>;
  updateReadingProgress(params: UpdateReadingProgressParams): Promise<void>;
  listLibrarySnapshot(): Promise<LibrarySnapshot>;
  createLibraryFolder(params: CreateLibraryFolderParams): Promise<LibraryFolderItem>;
  renameLibraryFolder(params: RenameLibraryFolderParams): Promise<LibraryFolderItem>;
  moveDocumentToFolder(params: MoveDocumentToFolderParams): Promise<void>;
  translateText(params: TranslateTextParams): Promise<TranslateTextResult>;
  recognizeFormula(params: RecognizeFormulaParams): Promise<RecognizeFormulaResult>;
  explainFormula(params: ExplainFormulaParams): Promise<ExplainFormulaResult>;
  saveNote(params: SaveNoteParams): Promise<SaveNoteResult>;
  listNotesByDocument(documentId: string): Promise<NoteItem[]>;
  deleteNote(noteId: string): Promise<void>;
  listFormulasByDocument(documentId: string): Promise<FormulaItem[]>;
  getFormulaById(formulaId: string): Promise<FormulaItem | null>;
  exportMarkdown(params: ExportMarkdownParams): Promise<ExportMarkdownResult>;
  listHistory(params?: ListHistoryParams): Promise<HistoryItem[]>;
  saveAiSettings(params: SaveAiSettingsParams): Promise<void>;
  getAiSettings(): Promise<AiSettingsView | null>;
  saveMathpixSettings(params: SaveMathpixSettingsParams): Promise<void>;
  getMathpixSettings(): Promise<MathpixSettingsView | null>;
  testMathpixSettings(params: TestMathpixSettingsParams): Promise<ProviderHealthCheckResult>;
  savePix2TexSettings(params: SavePix2TexSettingsParams): Promise<void>;
  getPix2TexSettings(): Promise<Pix2TexSettingsView | null>;
  testPix2TexSettings(params: TestPix2TexSettingsParams): Promise<ProviderHealthCheckResult>;
  saveFormulaOcrSettings(params: SaveFormulaOcrSettingsParams): Promise<void>;
  getFormulaOcrSettings(): Promise<FormulaOcrSettingsView | null>;
  saveAutoTranslateSettings(params: { enabled: boolean }): Promise<void>;
  getAutoTranslateSettings(): Promise<AutoTranslateSettingsView>;
  saveThemeSettings(params: SaveThemeSettingsParams): Promise<void>;
  getThemeSettings(): Promise<ThemeSettingsView>;
  pickPdfFile(): Promise<PickPdfFileResult>;
  saveFormulaImage(params: SaveFormulaImageParams): Promise<SaveFormulaImageResult>;
  onAppMenuAction(listener: (action: AppMenuAction) => void): () => void;
};
