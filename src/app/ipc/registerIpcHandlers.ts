import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import type Database from "better-sqlite3";
import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from "electron";

import { ActivityHistoryRepository } from "@backend/db/repositories/ActivityHistoryRepository";
import { DocumentRepository } from "@backend/db/repositories/DocumentRepository";
import { FormulaRepository } from "@backend/db/repositories/FormulaRepository";
import { LibraryRepository } from "@backend/db/repositories/LibraryRepository";
import { NoteRepository } from "@backend/db/repositories/NoteRepository";
import { SettingsRepository } from "@backend/db/repositories/SettingsRepository";
import { TranslationCacheRepository } from "@backend/db/repositories/TranslationCacheRepository";
import { MarkdownExporter } from "@backend/export/MarkdownExporter";
import { MathpixProvider } from "@backend/providers/MathpixProvider";
import { OpenAiCompatibleProvider } from "@backend/providers/OpenAiCompatibleProvider";
import { Pix2TexProvider } from "@backend/providers/Pix2TexProvider";
import { SecureSettingsService } from "@backend/settings/SecureSettingsService";
import { IPC_CHANNELS } from "@shared/ipc/channels";
import type {
  AiSettingsView,
  AppError,
  AppErrorCode,
  HoverTranslateSettingsView,
  CreateLibraryFolderParams,
  ExplainFormulaParams,
  ExportMarkdownParams,
  FormulaOcrProvider,
  FormulaOcrSettingsView,
  IpcResult,
  LaunchState,
  LibraryFolderItem,
  LibrarySnapshot,
  ListHistoryParams,
  MathpixSettingsView,
  MoveDocumentToFolderParams,
  OpenDocumentParams,
  OpenDocumentResult,
  Pix2TexSettingsView,
  PickPdfFileResult,
  ProviderHealthCheckResult,
  ReadDocumentBinaryParams,
  RecognizeFormulaParams,
  RecognizeFormulaResult,
  RenameLibraryFolderParams,
  SaveAiSettingsParams,
  SaveFormulaImageParams,
  SaveFormulaImageResult,
  SaveFormulaOcrSettingsParams,
  SaveMathpixSettingsParams,
  SaveNoteParams,
  SaveNoteResult,
  SavePix2TexSettingsParams,
  SaveThemeSettingsParams,
  TestMathpixSettingsParams,
  TestPix2TexSettingsParams,
  ThemeSettingsView,
  TranslateTextParams,
  TranslateTextResult,
  UpdateReadingProgressParams,
} from "@shared/types";

class BackendError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly retryable?: boolean,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

type RegisterIpcHandlersOptions = {
  db: Database.Database;
  userDataPath: string;
  documentsPath: string;
};

type RuntimeAiConfig = {
  baseURL: string;
  apiKey: string;
  model: string;
};

type RuntimeMathpixConfig = {
  appId: string;
  appKey: string;
};

type RuntimePix2TexConfig = {
  pythonPath: string;
  scriptPath: string;
};

const AI_META_KEY = "ai.provider.meta";
const MATHPIX_META_KEY = "mathpix.meta";
const PIX2TEX_META_KEY = "pix2tex.meta";
const FORMULA_OCR_META_KEY = "formula.ocr.meta";
const THEME_META_KEY = "ui.theme.meta";
const HOVER_TRANSLATE_META_KEY = "ui.hover-translate.meta";
const DEFAULT_THEME_SETTINGS: ThemeSettingsView = {
  accentColor: "#7f4f24",
};

export function registerIpcHandlers(options: RegisterIpcHandlersOptions): void {
  const documentRepository = new DocumentRepository(options.db);
  const noteRepository = new NoteRepository(options.db);
  const formulaRepository = new FormulaRepository(options.db);
  const libraryRepository = new LibraryRepository(options.db);
  const translationCacheRepository = new TranslationCacheRepository(options.db);
  const activityHistoryRepository = new ActivityHistoryRepository(options.db);
  const settingsRepository = new SettingsRepository(options.db);
  const secureSettingsService = new SecureSettingsService(
    join(options.userDataPath, "secure", "settings.json"),
  );
  const aiProvider = new OpenAiCompatibleProvider();
  const mathpixProvider = new MathpixProvider();
  const pix2texProvider = new Pix2TexProvider();
  const markdownExporter = new MarkdownExporter();

  const register = <TPayload, TResult>(
    channel: string,
    handler: (payload: TPayload, event: IpcMainInvokeEvent) => Promise<TResult> | TResult,
  ) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, payload): Promise<IpcResult<TResult>> => {
      try {
        const data = await handler(payload as TPayload, event);
        return { ok: true, data };
      } catch (error) {
        return {
          ok: false,
          error: toAppError(error),
        };
      }
    });
  };

  register<undefined, LaunchState>(IPC_CHANNELS.APP_GET_LAUNCH_STATE, async () => {
    const latestDocument = documentRepository.getLatestRecentDocument();

    if (!latestDocument) {
      return {
        mode: "library",
        reason: "first_launch",
      };
    }

    try {
      await stat(latestDocument.filePath);
    } catch {
      return {
        mode: "library",
        reason: "missing_recent_document",
        missingFileName: latestDocument.fileName,
      };
    }

    return {
      mode: "resume",
      document: await openDocumentRecord(documentRepository, {
        filePath: latestDocument.filePath,
        libraryFolderId: latestDocument.libraryFolderId ?? null,
      }),
    };
  });

  register<SaveAiSettingsParams, void>(IPC_CHANNELS.SETTINGS_SAVE_AI, (payload) => {
    assertNonEmptyString(payload.baseURL, "INVALID_PARAMS", "baseURL 不能为空");
    assertNonEmptyString(payload.model, "INVALID_PARAMS", "model 不能为空");
    const existingApiKey = secureSettingsService.getAiSecret();
    const nextApiKey = payload.apiKey?.trim();

    if (!nextApiKey && !existingApiKey) {
      throw new BackendError("INVALID_PARAMS", "首次保存 AI 配置时必须填写 API Key");
    }

    settingsRepository.upsert(AI_META_KEY, {
      baseURL: payload.baseURL,
      model: payload.model,
      configured: true,
    } satisfies AiSettingsView);

    if (nextApiKey) {
      secureSettingsService.saveAiSecret(nextApiKey);
    }
  });

  register<undefined, AiSettingsView | null>(IPC_CHANNELS.SETTINGS_GET_AI, () => {
    const meta = settingsRepository.get<AiSettingsView>(AI_META_KEY);
    const apiKey = secureSettingsService.getAiSecret();

    if (!meta) {
      return null;
    }

    return {
      baseURL: meta.baseURL,
      model: meta.model,
      configured: Boolean(apiKey),
    };
  });

  register<SaveMathpixSettingsParams, void>(IPC_CHANNELS.SETTINGS_SAVE_MATHPIX, (payload) => {
    assertNonEmptyString(payload.appId, "INVALID_PARAMS", "appId 不能为空");
    const existingAppKey = secureSettingsService.getMathpixSecret();
    const nextAppKey = payload.appKey?.trim();

    if (!nextAppKey && !existingAppKey) {
      throw new BackendError("INVALID_PARAMS", "首次保存 Mathpix 配置时必须填写 App Key");
    }

    settingsRepository.upsert(MATHPIX_META_KEY, {
      appId: payload.appId,
      configured: true,
    } satisfies MathpixSettingsView);

    if (nextAppKey) {
      secureSettingsService.saveMathpixSecret(nextAppKey);
    }
  });

  register<undefined, MathpixSettingsView | null>(IPC_CHANNELS.SETTINGS_GET_MATHPIX, () => {
    const meta = settingsRepository.get<MathpixSettingsView>(MATHPIX_META_KEY);
    const appKey = secureSettingsService.getMathpixSecret();

    if (!meta) {
      return null;
    }

    return {
      appId: meta.appId,
      configured: Boolean(appKey),
    };
  });

  register<TestMathpixSettingsParams, ProviderHealthCheckResult>(
    IPC_CHANNELS.SETTINGS_TEST_MATHPIX,
    async (payload) => {
      assertNonEmptyString(payload.appId, "INVALID_PARAMS", "appId 不能为空");
      const appKey = payload.appKey?.trim() || secureSettingsService.getMathpixSecret();

      if (!appKey) {
        throw new BackendError("INVALID_PARAMS", "测试 Mathpix 前请填写 App Key，或先保存已有配置");
      }

      return mathpixProvider.testConnection({
        appId: payload.appId.trim(),
        appKey,
      });
    },
  );

  register<SavePix2TexSettingsParams, void>(IPC_CHANNELS.SETTINGS_SAVE_PIX2TEX, (payload) => {
    assertNonEmptyString(payload.pythonPath, "INVALID_PARAMS", "pythonPath 不能为空");

    settingsRepository.upsert(PIX2TEX_META_KEY, {
      pythonPath: payload.pythonPath.trim(),
      configured: true,
    } satisfies Pix2TexSettingsView);
  });

  register<undefined, Pix2TexSettingsView | null>(IPC_CHANNELS.SETTINGS_GET_PIX2TEX, () => {
    return settingsRepository.get<Pix2TexSettingsView>(PIX2TEX_META_KEY);
  });

  register<TestPix2TexSettingsParams, ProviderHealthCheckResult>(
    IPC_CHANNELS.SETTINGS_TEST_PIX2TEX,
    async (payload) => {
      assertNonEmptyString(payload.pythonPath, "INVALID_PARAMS", "pythonPath 不能为空");

      return pix2texProvider.testEnvironment({
        pythonPath: payload.pythonPath.trim(),
        scriptPath: join(process.cwd(), "src", "backend", "ocr", "pix2tex_runner.py"),
      });
    },
  );

  register<SaveFormulaOcrSettingsParams, void>(IPC_CHANNELS.SETTINGS_SAVE_FORMULA_OCR, (payload) => {
    if (payload.provider !== "mathpix" && payload.provider !== "pix2tex") {
      throw new BackendError("INVALID_PARAMS", "公式 OCR provider 非法");
    }

    settingsRepository.upsert(FORMULA_OCR_META_KEY, {
      provider: payload.provider,
    } satisfies FormulaOcrSettingsView);
  });

  register<undefined, FormulaOcrSettingsView>(IPC_CHANNELS.SETTINGS_GET_FORMULA_OCR, () => {
    return (
      settingsRepository.get<FormulaOcrSettingsView>(FORMULA_OCR_META_KEY) ?? {
        provider: "mathpix",
      }
    );
  });

  register<SaveThemeSettingsParams, void>(IPC_CHANNELS.SETTINGS_SAVE_THEME, (payload) => {
    if (!isHexColor(payload.accentColor)) {
      throw new BackendError("INVALID_PARAMS", "主题色必须是 #RRGGBB 格式");
    }

    settingsRepository.upsert(THEME_META_KEY, {
      accentColor: payload.accentColor,
    } satisfies ThemeSettingsView);
  });

  register<undefined, ThemeSettingsView>(IPC_CHANNELS.SETTINGS_GET_THEME, () => {
    return settingsRepository.get<ThemeSettingsView>(THEME_META_KEY) ?? DEFAULT_THEME_SETTINGS;
  });

  register<{ enabled: boolean }, void>(IPC_CHANNELS.SETTINGS_SAVE_HOVER_TRANSLATE, (payload) => {
    settingsRepository.upsert(HOVER_TRANSLATE_META_KEY, {
      enabled: Boolean(payload.enabled),
    } satisfies HoverTranslateSettingsView);
  });

  register<undefined, HoverTranslateSettingsView>(
    IPC_CHANNELS.SETTINGS_GET_HOVER_TRANSLATE,
    () => {
      return (
        settingsRepository.get<HoverTranslateSettingsView>(HOVER_TRANSLATE_META_KEY) ?? {
          enabled: false,
        }
      );
    },
  );

  register<undefined, PickPdfFileResult>(IPC_CHANNELS.DIALOG_PICK_PDF, async (_payload, event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const dialogOptions: OpenDialogOptions = {
      title: "选择 PDF 文件",
      defaultPath: options.documentsPath,
      properties: ["openFile"],
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    };
    const result = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    return {
      canceled: result.canceled,
      filePath: result.filePaths[0],
    };
  });

  register<OpenDocumentParams, OpenDocumentResult>(IPC_CHANNELS.DOCUMENT_OPEN, async (payload) => {
    assertNonEmptyString(payload.filePath, "INVALID_PARAMS", "filePath 不能为空");
    return openDocumentRecord(documentRepository, payload);
  });

  register<undefined, ReturnType<DocumentRepository["listRecentDocuments"]>>(
    IPC_CHANNELS.DOCUMENT_LIST_RECENT,
    () => documentRepository.listRecentDocuments(),
  );

  register<undefined, LibrarySnapshot>(IPC_CHANNELS.LIBRARY_LIST_SNAPSHOT, () => ({
    folders: libraryRepository.listFolders(),
    documents: documentRepository.listLibraryDocuments(),
  }));

  register<CreateLibraryFolderParams, LibraryFolderItem>(
    IPC_CHANNELS.LIBRARY_CREATE_FOLDER,
    (payload) => {
      assertNonEmptyString(payload.name, "INVALID_PARAMS", "folder name 不能为空");

      if (payload.parentId) {
        const parentFolder = libraryRepository.getFolderById(payload.parentId);
        if (!parentFolder) {
          throw new BackendError("NOT_FOUND", "上级文件夹不存在");
        }
      }

      return libraryRepository.createFolder({
        name: payload.name.trim(),
        parentId: payload.parentId ?? null,
      });
    },
  );

  register<RenameLibraryFolderParams, LibraryFolderItem>(
    IPC_CHANNELS.LIBRARY_RENAME_FOLDER,
    (payload) => {
      assertNonEmptyString(payload.folderId, "INVALID_PARAMS", "folderId 不能为空");
      assertNonEmptyString(payload.name, "INVALID_PARAMS", "folder name 不能为空");

      const folder = libraryRepository.renameFolder(payload.folderId, payload.name.trim());
      if (!folder) {
        throw new BackendError("NOT_FOUND", "要重命名的文件夹不存在");
      }

      return folder;
    },
  );

  register<MoveDocumentToFolderParams, void>(IPC_CHANNELS.LIBRARY_MOVE_DOCUMENT, (payload) => {
    assertNonEmptyString(payload.documentId, "INVALID_PARAMS", "documentId 不能为空");

    if (payload.folderId) {
      const folder = libraryRepository.getFolderById(payload.folderId);
      if (!folder) {
        throw new BackendError("NOT_FOUND", "目标文件夹不存在");
      }
    }

    const document = documentRepository.getById(payload.documentId);
    if (!document) {
      throw new BackendError("NOT_FOUND", "文档不存在");
    }

    documentRepository.moveDocumentToFolder(payload.documentId, payload.folderId ?? null);
  });

  register<ReadDocumentBinaryParams, ArrayBuffer>(
    IPC_CHANNELS.DOCUMENT_READ_BINARY,
    async (payload) => {
      assertNonEmptyString(payload.filePath, "INVALID_PARAMS", "filePath 不能为空");
      const bytes = await readFile(payload.filePath);
      const view = new Uint8Array(bytes);
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    },
  );

  register<UpdateReadingProgressParams, void>(
    IPC_CHANNELS.DOCUMENT_UPDATE_PROGRESS,
    (payload) => {
      assertNonEmptyString(payload.documentId, "INVALID_PARAMS", "documentId 不能为空");

      documentRepository.touchRecentDocument({
        documentId: payload.documentId,
        lastPage: payload.lastPage,
        lastZoom: payload.lastZoom,
        scrollTopRatio: payload.scrollTopRatio,
      });
    },
  );

  register<TranslateTextParams, TranslateTextResult>(IPC_CHANNELS.TRANSLATE_TEXT, async (payload) => {
    assertNonEmptyString(payload.documentId, "INVALID_PARAMS", "documentId 不能为空");
    assertNonEmptyString(payload.text, "INVALID_PARAMS", "text 不能为空");
    assertNonEmptyString(payload.targetLang, "INVALID_PARAMS", "targetLang 不能为空");

    const aiConfig = getAiRuntimeConfig(settingsRepository, secureSettingsService);
    const cacheKey = createHash("sha256")
      .update([payload.text, payload.targetLang, aiConfig.model].join("\n"))
      .digest("hex");

    const cached = translationCacheRepository.getByCacheKey(cacheKey);
    if (cached) {
      return {
        translatedText: cached.translatedText,
        cached: true,
        model: cached.modelName,
      };
    }

    const translatedText = await aiProvider.translateText(aiConfig, {
      ...payload,
      formulaProtected: payload.formulaProtected ?? false,
    });
    translationCacheRepository.save({
      cacheKey,
      sourceText: payload.text,
      targetLang: payload.targetLang,
      translatedText,
      modelName: aiConfig.model,
    });
    activityHistoryRepository.log({
      documentId: payload.documentId,
      actionType: "translate_text",
      payload: {
        pageNumber: payload.pageNumber,
        sourcePreview: payload.text.slice(0, 120),
      },
    });

    return {
      translatedText,
      cached: false,
      model: aiConfig.model,
    };
  });

  register<SaveFormulaImageParams, SaveFormulaImageResult>(
    IPC_CHANNELS.FILE_SAVE_FORMULA_IMAGE,
    async (payload) => {
      assertNonEmptyString(payload.documentId, "INVALID_PARAMS", "documentId 不能为空");
      assertNonEmptyString(payload.imageDataUrl, "INVALID_PARAMS", "imageDataUrl 不能为空");

      const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(payload.imageDataUrl);
      if (!match) {
        throw new BackendError("INVALID_PARAMS", "imageDataUrl 不是合法的 base64 图片");
      }

      const mimeType = match[1];
      const base64Data = match[2];
      const extension =
        mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
      const directory = join(options.userDataPath, "formula-images", payload.documentId);
      await mkdir(directory, { recursive: true });

      const imagePath = join(directory, `${payload.pageNumber}-${Date.now()}.${extension}`);
      await writeFile(imagePath, Buffer.from(base64Data, "base64"));

      return { imagePath };
    },
  );

  register<RecognizeFormulaParams, RecognizeFormulaResult>(
    IPC_CHANNELS.FORMULA_RECOGNIZE,
    async (payload) => {
      assertNonEmptyString(payload.documentId, "INVALID_PARAMS", "documentId 不能为空");
      assertNonEmptyString(payload.imagePath, "INVALID_PARAMS", "imagePath 不能为空");

      const formulaOcrProvider = getFormulaOcrProvider(settingsRepository);
      const recognition =
        formulaOcrProvider === "pix2tex"
          ? await pix2texProvider.recognizeFormula(getPix2TexRuntimeConfig(settingsRepository), {
              imagePath: payload.imagePath,
            })
          : await mathpixProvider.recognizeFormula(
              getMathpixRuntimeConfig(settingsRepository, secureSettingsService),
              {
                imagePath: payload.imagePath,
              },
            );

      const formula = formulaRepository.create({
        documentId: payload.documentId,
        pageNumber: payload.pageNumber,
        bbox: payload.bbox,
        imagePath: payload.imagePath,
        latex: recognition.latex,
        confidence: recognition.confidence,
        ocrProvider: formulaOcrProvider,
        sourceContext: payload.sourceContext,
      });

      activityHistoryRepository.log({
        documentId: payload.documentId,
        actionType: "recognize_formula",
        payload: {
          pageNumber: payload.pageNumber,
          formulaId: formula.id,
          latex: recognition.latex,
        },
      });

      return {
        formulaId: formula.id,
        latex: recognition.latex,
        confidence: recognition.confidence,
        ocrProvider: formulaOcrProvider,
      };
    },
  );

  register<ExplainFormulaParams, Awaited<ReturnType<OpenAiCompatibleProvider["explainFormula"]>>>(
    IPC_CHANNELS.FORMULA_EXPLAIN,
    async (payload) => {
      assertNonEmptyString(payload.formulaId, "INVALID_PARAMS", "formulaId 不能为空");
      assertNonEmptyString(payload.latex, "INVALID_PARAMS", "latex 不能为空");

      const aiConfig = getAiRuntimeConfig(settingsRepository, secureSettingsService);
      const result = await aiProvider.explainFormula(aiConfig, {
        latex: payload.latex,
        context: payload.context,
      });

      formulaRepository.updateExplanation(payload.formulaId, result.explanation, result.variables);
      const formula = formulaRepository.getById(payload.formulaId);

      activityHistoryRepository.log({
        documentId: formula?.documentId,
        actionType: "explain_formula",
        payload: {
          formulaId: payload.formulaId,
          latex: payload.latex,
        },
      });

      return result;
    },
  );

  register<SaveNoteParams, SaveNoteResult>(IPC_CHANNELS.NOTE_SAVE, (payload) => {
    assertNonEmptyString(payload.documentId, "INVALID_PARAMS", "documentId 不能为空");

    const note = noteRepository.save(payload);

    activityHistoryRepository.log({
      documentId: payload.documentId,
      actionType: "save_note",
      payload: {
        noteId: note.id,
        noteType: payload.noteType,
        pageNumber: payload.pageNumber,
      },
    });

    return { noteId: note.id };
  });

  register<{ documentId: string }, ReturnType<NoteRepository["listByDocument"]>>(
    IPC_CHANNELS.NOTE_LIST_BY_DOCUMENT,
    (payload) => {
      assertNonEmptyString(payload.documentId, "INVALID_PARAMS", "documentId 不能为空");
      return noteRepository.listByDocument(payload.documentId);
    },
  );

  register<{ noteId: string }, void>(IPC_CHANNELS.NOTE_DELETE, (payload) => {
    assertNonEmptyString(payload.noteId, "INVALID_PARAMS", "noteId 不能为空");
    noteRepository.delete(payload.noteId);
  });

  register<{ documentId: string }, ReturnType<FormulaRepository["listByDocument"]>>(
    IPC_CHANNELS.FORMULA_LIST_BY_DOCUMENT,
    (payload) => {
      assertNonEmptyString(payload.documentId, "INVALID_PARAMS", "documentId 不能为空");
      return formulaRepository.listByDocument(payload.documentId);
    },
  );

  register<{ formulaId: string }, ReturnType<FormulaRepository["getById"]>>(
    IPC_CHANNELS.FORMULA_GET_BY_ID,
    (payload) => {
      assertNonEmptyString(payload.formulaId, "INVALID_PARAMS", "formulaId 不能为空");
      return formulaRepository.getById(payload.formulaId);
    },
  );

  register<ExportMarkdownParams, Awaited<ReturnType<MarkdownExporter["export"]>>>(
    IPC_CHANNELS.EXPORT_MARKDOWN,
    async (payload) => {
      assertNonEmptyString(payload.documentId, "INVALID_PARAMS", "documentId 不能为空");

      const document = documentRepository.getById(payload.documentId);
      if (!document) {
        throw new BackendError("NOT_FOUND", "文档不存在");
      }

      const notes = noteRepository.listByDocument(payload.documentId);
      const formulas = formulaRepository.listByDocument(payload.documentId);
      const result = await markdownExporter.export({
        document,
        notes,
        formulas,
        options: payload,
        defaultDirectory: options.documentsPath,
      });

      activityHistoryRepository.log({
        documentId: payload.documentId,
        actionType: "export_markdown",
        payload: {
          outputPath: result.outputPath,
          noteCount: result.noteCount,
          formulaCount: result.formulaCount,
        },
      });

      return result;
    },
  );

  register<ListHistoryParams | undefined, ReturnType<ActivityHistoryRepository["list"]>>(
    IPC_CHANNELS.HISTORY_LIST,
    (payload) => activityHistoryRepository.list(payload),
  );
}

function getAiRuntimeConfig(
  settingsRepository: SettingsRepository,
  secureSettingsService: SecureSettingsService,
): RuntimeAiConfig {
  const meta = settingsRepository.get<AiSettingsView>(AI_META_KEY);
  const apiKey = secureSettingsService.getAiSecret();

  if (!meta?.baseURL || !meta.model || !apiKey) {
    throw new BackendError(
      "UNAUTHORIZED",
      "AI 配置不完整，请先在设置页填写 baseURL、API Key 和 model",
    );
  }

  return {
    baseURL: meta.baseURL.replace(/\/+$/, ""),
    apiKey,
    model: meta.model,
  };
}

function getMathpixRuntimeConfig(
  settingsRepository: SettingsRepository,
  secureSettingsService: SecureSettingsService,
): RuntimeMathpixConfig {
  const meta = settingsRepository.get<MathpixSettingsView>(MATHPIX_META_KEY);
  const appKey = secureSettingsService.getMathpixSecret();

  if (!meta?.appId || !appKey) {
    throw new BackendError("UNAUTHORIZED", "Mathpix 配置不完整，请先填写 appId 和 appKey");
  }

  return {
    appId: meta.appId,
    appKey,
  };
}

function getPix2TexRuntimeConfig(settingsRepository: SettingsRepository): RuntimePix2TexConfig {
  const meta = settingsRepository.get<Pix2TexSettingsView>(PIX2TEX_META_KEY);

  if (!meta?.pythonPath) {
    throw new BackendError(
      "UNAUTHORIZED",
      "pix2tex 配置不完整，请先填写 Python 路径并确认该环境已安装 pix2tex",
    );
  }

  return {
    pythonPath: meta.pythonPath,
    scriptPath: join(process.cwd(), "src", "backend", "ocr", "pix2tex_runner.py"),
  };
}

function getFormulaOcrProvider(settingsRepository: SettingsRepository): FormulaOcrProvider {
  const meta = settingsRepository.get<FormulaOcrSettingsView>(FORMULA_OCR_META_KEY);
  return meta?.provider ?? "mathpix";
}

async function openDocumentRecord(
  documentRepository: DocumentRepository,
  payload: OpenDocumentParams,
): Promise<OpenDocumentResult> {
  const fileExtension = extname(payload.filePath).toLowerCase();
  if (fileExtension !== ".pdf") {
    throw new BackendError("INVALID_PARAMS", "仅支持打开 PDF 文件");
  }

  const fileStats = await stat(payload.filePath);
  const fileHash = await computeFileHash(payload.filePath);
  const document = documentRepository.upsertDocument({
    filePath: payload.filePath,
    fileName: basename(payload.filePath),
    fileHash,
    fileSize: fileStats.size,
    pageCount: 0,
    libraryFolderId: payload.libraryFolderId,
  });

  const recentState = documentRepository.getRecentState(document.id);
  documentRepository.touchRecentDocument({
    documentId: document.id,
    lastPage: recentState?.last_page ?? 1,
    lastZoom: recentState?.last_zoom ?? 1,
    scrollTopRatio: recentState?.scroll_top_ratio ?? undefined,
  });

  const latestRecentState = documentRepository.getRecentState(document.id);

  return {
    documentId: document.id,
    fileName: document.fileName,
    filePath: document.filePath,
    pageCount: document.pageCount,
    libraryFolderId: document.libraryFolderId ?? null,
    lastPage: latestRecentState?.last_page,
    lastZoom: latestRecentState?.last_zoom,
  };
}

function assertNonEmptyString(
  value: string | undefined,
  code: AppErrorCode,
  message: string,
): asserts value is string {
  if (!value || !value.trim()) {
    throw new BackendError(code, message);
  }
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

function toAppError(error: unknown): AppError {
  if (error instanceof BackendError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      code: normalizeUnknownErrorCode(error.message),
      message: error.message,
      retryable: false,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "Unknown error",
    retryable: false,
  };
}

function normalizeUnknownErrorCode(message: string): AppErrorCode {
  if (message.includes("Mathpix")) {
    return "MATHPIX_REQUEST_FAILED";
  }

  if (message.includes("pix2tex")) {
    return "LOCAL_OCR_FAILED";
  }

  if (message.includes("AI request")) {
    return "AI_REQUEST_FAILED";
  }

  if (message.includes("Export")) {
    return "EXPORT_FAILED";
  }

  return "UNKNOWN_ERROR";
}

async function computeFileHash(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
