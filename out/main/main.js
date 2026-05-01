import { dialog, safeStorage, ipcMain, BrowserWindow, app, Menu } from "electron";
import { basename, join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { constants, readFileSync, mkdirSync, writeFileSync, createReadStream } from "node:fs";
import { writeFile, readFile, access, stat, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
class DatabaseClient {
  connection;
  constructor(dbPath) {
    this.connection = new Database(dbPath);
    this.connection.pragma("journal_mode = WAL");
    this.connection.pragma("foreign_keys = ON");
  }
  close() {
    if (this.connection.open) {
      this.connection.close();
    }
  }
}
const initSql = "PRAGMA foreign_keys = ON;\n\nCREATE TABLE IF NOT EXISTS documents (\n  id TEXT PRIMARY KEY,\n  file_path TEXT NOT NULL,\n  file_name TEXT NOT NULL,\n  file_hash TEXT NOT NULL UNIQUE,\n  file_size INTEGER NOT NULL,\n  page_count INTEGER NOT NULL DEFAULT 0,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n);\n\nCREATE INDEX IF NOT EXISTS idx_documents_file_name\nON documents(file_name);\n\nCREATE TABLE IF NOT EXISTS formulas (\n  id TEXT PRIMARY KEY,\n  document_id TEXT NOT NULL,\n  page_number INTEGER NOT NULL,\n  bbox_json TEXT NOT NULL,\n  image_path TEXT NOT NULL,\n  latex TEXT,\n  explanation TEXT,\n  variables_json TEXT,\n  confidence REAL,\n  ocr_provider TEXT NOT NULL DEFAULT 'mathpix' CHECK(ocr_provider IN ('mathpix', 'pix2tex')),\n  source_context TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE\n);\n\nCREATE INDEX IF NOT EXISTS idx_formulas_document_page\nON formulas(document_id, page_number);\n\nCREATE TABLE IF NOT EXISTS notes (\n  id TEXT PRIMARY KEY,\n  document_id TEXT NOT NULL,\n  page_number INTEGER NOT NULL,\n  note_type TEXT NOT NULL CHECK(note_type IN ('highlight', 'comment', 'formula_favorite')),\n  selected_text TEXT,\n  translated_text TEXT,\n  comment TEXT,\n  color TEXT,\n  anchor_json TEXT,\n  rects_json TEXT,\n  formula_id TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,\n  FOREIGN KEY(formula_id) REFERENCES formulas(id) ON DELETE SET NULL\n);\n\nCREATE INDEX IF NOT EXISTS idx_notes_document_page\nON notes(document_id, page_number);\n\nCREATE INDEX IF NOT EXISTS idx_notes_type\nON notes(note_type);\n\nCREATE TABLE IF NOT EXISTS recent_documents (\n  id TEXT PRIMARY KEY,\n  document_id TEXT NOT NULL,\n  last_open_time TEXT NOT NULL,\n  last_page INTEGER NOT NULL DEFAULT 1,\n  last_zoom REAL NOT NULL DEFAULT 1,\n  scroll_top_ratio REAL,\n  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE\n);\n\nCREATE UNIQUE INDEX IF NOT EXISTS idx_recent_documents_document_id\nON recent_documents(document_id);\n\nCREATE INDEX IF NOT EXISTS idx_recent_documents_last_open_time\nON recent_documents(last_open_time DESC);\n\nCREATE TABLE IF NOT EXISTS translation_cache (\n  id TEXT PRIMARY KEY,\n  cache_key TEXT NOT NULL UNIQUE,\n  source_text TEXT NOT NULL,\n  target_lang TEXT NOT NULL,\n  translated_text TEXT NOT NULL,\n  model_name TEXT NOT NULL,\n  created_at TEXT NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS activity_history (\n  id TEXT PRIMARY KEY,\n  document_id TEXT,\n  action_type TEXT NOT NULL CHECK(\n    action_type IN (\n      'translate_text',\n      'recognize_formula',\n      'explain_formula',\n      'save_note',\n      'export_markdown'\n    )\n  ),\n  payload_json TEXT,\n  created_at TEXT NOT NULL,\n  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE SET NULL\n);\n\nCREATE INDEX IF NOT EXISTS idx_activity_history_action_time\nON activity_history(action_type, created_at DESC);\n\nCREATE TABLE IF NOT EXISTS settings (\n  key TEXT PRIMARY KEY,\n  value_json TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n);\n";
const formulaProviderPix2texSql = "PRAGMA foreign_keys = OFF;\n\nCREATE TABLE IF NOT EXISTS formulas_v2 (\n  id TEXT PRIMARY KEY,\n  document_id TEXT NOT NULL,\n  page_number INTEGER NOT NULL,\n  bbox_json TEXT NOT NULL,\n  image_path TEXT NOT NULL,\n  latex TEXT,\n  explanation TEXT,\n  variables_json TEXT,\n  confidence REAL,\n  ocr_provider TEXT NOT NULL DEFAULT 'mathpix' CHECK(ocr_provider IN ('mathpix', 'pix2tex')),\n  source_context TEXT,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE\n);\n\nINSERT INTO formulas_v2 (\n  id,\n  document_id,\n  page_number,\n  bbox_json,\n  image_path,\n  latex,\n  explanation,\n  variables_json,\n  confidence,\n  ocr_provider,\n  source_context,\n  created_at,\n  updated_at\n)\nSELECT\n  id,\n  document_id,\n  page_number,\n  bbox_json,\n  image_path,\n  latex,\n  explanation,\n  variables_json,\n  confidence,\n  ocr_provider,\n  source_context,\n  created_at,\n  updated_at\nFROM formulas;\n\nDROP TABLE formulas;\n\nALTER TABLE formulas_v2 RENAME TO formulas;\n\nCREATE INDEX IF NOT EXISTS idx_formulas_document_page\nON formulas(document_id, page_number);\n\nPRAGMA foreign_keys = ON;\n";
const libraryRepositorySql = "CREATE TABLE IF NOT EXISTS library_folders (\n  id TEXT PRIMARY KEY,\n  parent_id TEXT,\n  name TEXT NOT NULL,\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  FOREIGN KEY(parent_id) REFERENCES library_folders(id) ON DELETE CASCADE\n);\n\nCREATE INDEX IF NOT EXISTS idx_library_folders_parent_id\nON library_folders(parent_id);\n\nALTER TABLE documents\nADD COLUMN library_folder_id TEXT REFERENCES library_folders(id) ON DELETE SET NULL;\n\nCREATE INDEX IF NOT EXISTS idx_documents_library_folder_id\nON documents(library_folder_id);\n";
const MIGRATIONS = [
  {
    id: "001_init",
    sql: initSql
  },
  {
    id: "002_formula_ocr_provider_pix2tex",
    sql: formulaProviderPix2texSql
  },
  {
    id: "003_library_repository",
    sql: libraryRepositorySql
  }
];
function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const appliedRows = db.prepare("SELECT id FROM schema_migrations").all();
  const appliedIds = new Set(appliedRows.map((row) => row.id));
  const insertApplied = db.prepare(`
    INSERT INTO schema_migrations (id, applied_at)
    VALUES (@id, @applied_at)
  `);
  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) {
      continue;
    }
    const applyMigration = db.transaction(() => {
      db.exec(migration.sql);
      insertApplied.run({
        id: migration.id,
        applied_at: (/* @__PURE__ */ new Date()).toISOString()
      });
    });
    applyMigration();
  }
}
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
  SETTINGS_SAVE_AUTO_TRANSLATE: "settings:save-auto-translate",
  SETTINGS_GET_AUTO_TRANSLATE: "settings:get-auto-translate",
  SETTINGS_SAVE_THEME: "settings:save-theme",
  SETTINGS_GET_THEME: "settings:get-theme",
  DIALOG_PICK_PDF: "dialog:pick-pdf",
  FILE_SAVE_FORMULA_IMAGE: "file:save-formula-image",
  APP_MENU_ACTION: "app:menu-action"
};
function parseJson(value) {
  if (!value) {
    return void 0;
  }
  try {
    return JSON.parse(value);
  } catch {
    return void 0;
  }
}
function stringifyJson(value) {
  if (value === void 0) {
    return null;
  }
  return JSON.stringify(value);
}
class ActivityHistoryRepository {
  constructor(db) {
    this.db = db;
  }
  log(params) {
    this.db.prepare(`
        INSERT INTO activity_history (
          id,
          document_id,
          action_type,
          payload_json,
          created_at
        )
        VALUES (
          @id,
          @document_id,
          @action_type,
          @payload_json,
          @created_at
        )
      `).run({
      id: randomUUID(),
      document_id: params.documentId ?? null,
      action_type: params.actionType,
      payload_json: stringifyJson(params.payload),
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  list(params) {
    const conditions = [];
    const values = [];
    if (params?.documentId) {
      conditions.push("document_id = ?");
      values.push(params.documentId);
    }
    if (params?.actionType) {
      conditions.push("action_type = ?");
      values.push(params.actionType);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = params?.limit ?? 50;
    const rows = this.db.prepare(`
        SELECT *
        FROM activity_history
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ?
      `).all(...values, limit);
    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_id ?? void 0,
      actionType: row.action_type,
      payload: parseJson(row.payload_json) ?? null,
      createdAt: row.created_at
    }));
  }
}
class DocumentRepository {
  constructor(db) {
    this.db = db;
  }
  upsertDocument(params) {
    const existing = this.db.prepare("SELECT * FROM documents WHERE file_hash = ?").get(params.fileHash);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const pageCount = params.pageCount ?? existing?.page_count ?? 0;
    if (existing) {
      this.db.prepare(`
          UPDATE documents
          SET file_path = @file_path,
              file_name = @file_name,
              file_size = @file_size,
              page_count = @page_count,
              library_folder_id = @library_folder_id,
              updated_at = @updated_at
          WHERE id = @id
        `).run({
        id: existing.id,
        file_path: params.filePath,
        file_name: params.fileName,
        file_size: params.fileSize,
        page_count: pageCount,
        library_folder_id: params.libraryFolderId === void 0 ? existing.library_folder_id : params.libraryFolderId,
        updated_at: now
      });
      return {
        id: existing.id,
        filePath: params.filePath,
        fileName: params.fileName,
        fileHash: params.fileHash,
        fileSize: params.fileSize,
        pageCount,
        libraryFolderId: params.libraryFolderId === void 0 ? existing.library_folder_id : params.libraryFolderId,
        createdAt: existing.created_at,
        updatedAt: now
      };
    }
    const record = {
      id: randomUUID(),
      filePath: params.filePath,
      fileName: params.fileName,
      fileHash: params.fileHash,
      fileSize: params.fileSize,
      pageCount,
      libraryFolderId: params.libraryFolderId ?? null,
      createdAt: now,
      updatedAt: now
    };
    this.db.prepare(`
        INSERT INTO documents (
          id,
          file_path,
          file_name,
          file_hash,
          file_size,
          page_count,
          library_folder_id,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          @file_path,
          @file_name,
          @file_hash,
          @file_size,
          @page_count,
          @library_folder_id,
          @created_at,
          @updated_at
        )
      `).run({
      id: record.id,
      file_path: record.filePath,
      file_name: record.fileName,
      file_hash: record.fileHash,
      file_size: record.fileSize,
      page_count: record.pageCount,
      library_folder_id: record.libraryFolderId ?? null,
      created_at: record.createdAt,
      updated_at: record.updatedAt
    });
    return record;
  }
  getById(documentId) {
    const row = this.db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      filePath: row.file_path,
      fileName: row.file_name,
      fileHash: row.file_hash,
      fileSize: row.file_size,
      pageCount: row.page_count,
      libraryFolderId: row.library_folder_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  getRecentState(documentId) {
    const row = this.db.prepare("SELECT * FROM recent_documents WHERE document_id = ?").get(documentId);
    return row ?? null;
  }
  touchRecentDocument(params) {
    const existing = this.getRecentState(params.documentId);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (existing) {
      this.db.prepare(`
          UPDATE recent_documents
          SET last_open_time = @last_open_time,
              last_page = @last_page,
              last_zoom = @last_zoom,
              scroll_top_ratio = @scroll_top_ratio
          WHERE document_id = @document_id
        `).run({
        document_id: params.documentId,
        last_open_time: now,
        last_page: params.lastPage,
        last_zoom: params.lastZoom,
        scroll_top_ratio: params.scrollTopRatio ?? null
      });
      return;
    }
    this.db.prepare(`
        INSERT INTO recent_documents (
          id,
          document_id,
          last_open_time,
          last_page,
          last_zoom,
          scroll_top_ratio
        )
        VALUES (
          @id,
          @document_id,
          @last_open_time,
          @last_page,
          @last_zoom,
          @scroll_top_ratio
        )
      `).run({
      id: randomUUID(),
      document_id: params.documentId,
      last_open_time: now,
      last_page: params.lastPage,
      last_zoom: params.lastZoom,
      scroll_top_ratio: params.scrollTopRatio ?? null
    });
  }
  listRecentDocuments() {
    const rows = this.db.prepare(`
        SELECT
          d.id AS document_id,
          d.file_name AS file_name,
          d.file_path AS file_path,
          d.page_count AS page_count,
          d.library_folder_id AS library_folder_id,
          r.last_open_time AS last_open_time,
          r.last_page AS last_page,
          r.last_zoom AS last_zoom
        FROM recent_documents r
        INNER JOIN documents d ON d.id = r.document_id
        ORDER BY r.last_open_time DESC
      `).all();
    return rows.map((row) => ({
      documentId: row.document_id,
      fileName: row.file_name,
      filePath: row.file_path,
      pageCount: row.page_count,
      libraryFolderId: row.library_folder_id,
      lastOpenTime: row.last_open_time,
      lastPage: row.last_page,
      lastZoom: row.last_zoom
    }));
  }
  listLibraryDocuments() {
    const rows = this.db.prepare(`
        SELECT
          d.id AS document_id,
          d.file_name AS file_name,
          d.file_path AS file_path,
          d.page_count AS page_count,
          d.library_folder_id AS library_folder_id,
          r.last_open_time AS last_open_time,
          r.last_page AS last_page,
          r.last_zoom AS last_zoom
        FROM documents d
        LEFT JOIN recent_documents r ON r.document_id = d.id
        ORDER BY COALESCE(r.last_open_time, d.updated_at) DESC, d.file_name COLLATE NOCASE ASC
      `).all();
    return rows.map((row) => ({
      documentId: row.document_id,
      fileName: row.file_name,
      filePath: row.file_path,
      pageCount: row.page_count,
      libraryFolderId: row.library_folder_id,
      lastOpenTime: row.last_open_time ?? void 0,
      lastPage: row.last_page ?? void 0,
      lastZoom: row.last_zoom ?? void 0
    }));
  }
  moveDocumentToFolder(documentId, folderId) {
    this.db.prepare(`
        UPDATE documents
        SET library_folder_id = @library_folder_id,
            updated_at = @updated_at
        WHERE id = @document_id
      `).run({
      document_id: documentId,
      library_folder_id: folderId ?? null,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  getLatestRecentDocument() {
    return this.listRecentDocuments()[0] ?? null;
  }
}
class FormulaRepository {
  constructor(db) {
    this.db = db;
  }
  create(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const formula = {
      id: randomUUID(),
      documentId: params.documentId,
      pageNumber: params.pageNumber,
      bbox: params.bbox,
      imagePath: params.imagePath,
      latex: params.latex,
      confidence: params.confidence,
      ocrProvider: params.ocrProvider,
      sourceContext: params.sourceContext,
      createdAt: now,
      updatedAt: now
    };
    this.db.prepare(`
        INSERT INTO formulas (
          id,
          document_id,
          page_number,
          bbox_json,
          image_path,
          latex,
          confidence,
          ocr_provider,
          source_context,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          @document_id,
          @page_number,
          @bbox_json,
          @image_path,
          @latex,
          @confidence,
          @ocr_provider,
          @source_context,
          @created_at,
          @updated_at
        )
      `).run({
      id: formula.id,
      document_id: formula.documentId,
      page_number: formula.pageNumber,
      bbox_json: stringifyJson(formula.bbox),
      image_path: formula.imagePath,
      latex: formula.latex ?? null,
      confidence: formula.confidence ?? null,
      ocr_provider: formula.ocrProvider,
      source_context: formula.sourceContext ?? null,
      created_at: formula.createdAt,
      updated_at: formula.updatedAt
    });
    return formula;
  }
  updateExplanation(formulaId, explanation, variables) {
    this.db.prepare(`
        UPDATE formulas
        SET explanation = @explanation,
            variables_json = @variables_json,
            updated_at = @updated_at
        WHERE id = @id
      `).run({
      id: formulaId,
      explanation,
      variables_json: stringifyJson(variables),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  listByDocument(documentId) {
    const rows = this.db.prepare(`
        SELECT *
        FROM formulas
        WHERE document_id = ?
        ORDER BY page_number ASC, created_at DESC
      `).all(documentId);
    return rows.map((row) => this.mapRow(row));
  }
  getById(formulaId) {
    const row = this.db.prepare("SELECT * FROM formulas WHERE id = ?").get(formulaId);
    return row ? this.mapRow(row) : null;
  }
  mapRow(row) {
    return {
      id: row.id,
      documentId: row.document_id,
      pageNumber: row.page_number,
      bbox: parseJson(row.bbox_json) ?? {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        coordSpace: "page_normalized",
        origin: "top_left"
      },
      imagePath: row.image_path,
      latex: row.latex ?? void 0,
      explanation: row.explanation ?? void 0,
      variables: parseJson(row.variables_json),
      confidence: row.confidence ?? void 0,
      ocrProvider: row.ocr_provider,
      sourceContext: row.source_context ?? void 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
class LibraryRepository {
  constructor(db) {
    this.db = db;
  }
  listFolders() {
    const rows = this.db.prepare(`
        SELECT
          f.id,
          f.parent_id,
          f.name,
          f.created_at,
          f.updated_at,
          COUNT(d.id) AS document_count
        FROM library_folders f
        LEFT JOIN documents d ON d.library_folder_id = f.id
        GROUP BY f.id, f.parent_id, f.name, f.created_at, f.updated_at
        ORDER BY f.name COLLATE NOCASE ASC
      `).all();
    return rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      documentCount: row.document_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }
  getFolderById(folderId) {
    const row = this.db.prepare(`
        SELECT
          f.id,
          f.parent_id,
          f.name,
          f.created_at,
          f.updated_at,
          COUNT(d.id) AS document_count
        FROM library_folders f
        LEFT JOIN documents d ON d.library_folder_id = f.id
        WHERE f.id = ?
        GROUP BY f.id, f.parent_id, f.name, f.created_at, f.updated_at
      `).get(folderId);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      documentCount: row.document_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
  createFolder(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const folderId = randomUUID();
    this.db.prepare(`
        INSERT INTO library_folders (
          id,
          parent_id,
          name,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          @parent_id,
          @name,
          @created_at,
          @updated_at
        )
      `).run({
      id: folderId,
      parent_id: params.parentId ?? null,
      name: params.name,
      created_at: now,
      updated_at: now
    });
    return {
      id: folderId,
      parentId: params.parentId ?? null,
      name: params.name,
      documentCount: 0,
      createdAt: now,
      updatedAt: now
    };
  }
  renameFolder(folderId, name) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const result = this.db.prepare(`
        UPDATE library_folders
        SET name = @name,
            updated_at = @updated_at
        WHERE id = @id
      `).run({
      id: folderId,
      name,
      updated_at: now
    });
    if (result.changes === 0) {
      return null;
    }
    return this.getFolderById(folderId);
  }
}
class NoteRepository {
  constructor(db) {
    this.db = db;
  }
  save(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const note = {
      id: randomUUID(),
      documentId: params.documentId,
      pageNumber: params.pageNumber,
      noteType: params.noteType,
      selectedText: params.selectedText,
      translatedText: params.translatedText,
      comment: params.comment,
      color: params.color,
      anchorJson: params.anchorJson,
      rectsJson: params.rectsJson,
      formulaId: params.formulaId,
      createdAt: now,
      updatedAt: now
    };
    this.db.prepare(`
        INSERT INTO notes (
          id,
          document_id,
          page_number,
          note_type,
          selected_text,
          translated_text,
          comment,
          color,
          anchor_json,
          rects_json,
          formula_id,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          @document_id,
          @page_number,
          @note_type,
          @selected_text,
          @translated_text,
          @comment,
          @color,
          @anchor_json,
          @rects_json,
          @formula_id,
          @created_at,
          @updated_at
        )
      `).run({
      id: note.id,
      document_id: note.documentId,
      page_number: note.pageNumber,
      note_type: note.noteType,
      selected_text: note.selectedText ?? null,
      translated_text: note.translatedText ?? null,
      comment: note.comment ?? null,
      color: note.color ?? null,
      anchor_json: stringifyJson(note.anchorJson),
      rects_json: stringifyJson(note.rectsJson),
      formula_id: note.formulaId ?? null,
      created_at: note.createdAt,
      updated_at: note.updatedAt
    });
    return note;
  }
  listByDocument(documentId) {
    const rows = this.db.prepare(`
        SELECT *
        FROM notes
        WHERE document_id = ?
        ORDER BY page_number ASC, created_at DESC
      `).all(documentId);
    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      pageNumber: row.page_number,
      noteType: row.note_type,
      selectedText: row.selected_text ?? void 0,
      translatedText: row.translated_text ?? void 0,
      comment: row.comment ?? void 0,
      color: row.color ?? void 0,
      anchorJson: parseJson(row.anchor_json),
      rectsJson: parseJson(row.rects_json),
      formulaId: row.formula_id ?? void 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }
  delete(noteId) {
    this.db.prepare("DELETE FROM notes WHERE id = ?").run(noteId);
  }
}
class SettingsRepository {
  constructor(db) {
    this.db = db;
  }
  upsert(key, value) {
    this.db.prepare(`
        INSERT INTO settings (key, value_json, updated_at)
        VALUES (@key, @value_json, @updated_at)
        ON CONFLICT(key)
        DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `).run({
      key,
      value_json: JSON.stringify(value),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  get(key) {
    const row = this.db.prepare("SELECT * FROM settings WHERE key = ?").get(key);
    if (!row) {
      return null;
    }
    return parseJson(row.value_json) ?? null;
  }
}
class TranslationCacheRepository {
  constructor(db) {
    this.db = db;
  }
  getByCacheKey(cacheKey) {
    const row = this.db.prepare("SELECT * FROM translation_cache WHERE cache_key = ?").get(cacheKey);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      cacheKey: row.cache_key,
      sourceText: row.source_text,
      targetLang: row.target_lang,
      translatedText: row.translated_text,
      modelName: row.model_name,
      createdAt: row.created_at
    };
  }
  save(params) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.db.prepare(`
        INSERT OR REPLACE INTO translation_cache (
          id,
          cache_key,
          source_text,
          target_lang,
          translated_text,
          model_name,
          created_at
        )
        VALUES (
          @id,
          @cache_key,
          @source_text,
          @target_lang,
          @translated_text,
          @model_name,
          @created_at
        )
      `).run({
      id: randomUUID(),
      cache_key: params.cacheKey,
      source_text: params.sourceText,
      target_lang: params.targetLang,
      translated_text: params.translatedText,
      model_name: params.modelName,
      created_at: now
    });
  }
}
class MarkdownExporter {
  async export(params) {
    const outputPath = params.options.outputPath || await this.pickOutputPath(
      params.document.fileName,
      params.defaultDirectory,
      params.ownerWindow ?? null
    );
    const markdown = this.buildMarkdown(params.document, params.notes, params.formulas, params.options);
    await writeFile(outputPath, markdown, "utf8");
    const uniqueFormulaIds = new Set(
      params.notes.filter((note) => note.noteType === "formula_favorite").map((note) => note.formulaId)
    );
    return {
      outputPath,
      noteCount: params.notes.length,
      formulaCount: [...uniqueFormulaIds].filter(Boolean).length
    };
  }
  async pickOutputPath(fileName, defaultDirectory, ownerWindow) {
    const suggestedName = `${basename(fileName, ".pdf")}-notes.md`;
    const dialogOptions = {
      title: "导出 Markdown",
      defaultPath: join(defaultDirectory, suggestedName),
      filters: [{ name: "Markdown", extensions: ["md"] }]
    };
    const result = ownerWindow ? await dialog.showSaveDialog(ownerWindow, dialogOptions) : await dialog.showSaveDialog(dialogOptions);
    if (result.canceled || !result.filePath) {
      throw new Error("Export canceled");
    }
    return result.filePath;
  }
  buildMarkdown(document, notes, formulas, options) {
    const formulaMap = new Map(formulas.map((formula) => [formula.id, formula]));
    const lines = [
      `# ${document.fileName}`,
      "",
      `- Source: ${document.filePath}`,
      `- Exported At: ${(/* @__PURE__ */ new Date()).toISOString()}`,
      ""
    ];
    if (notes.length === 0) {
      lines.push("暂无笔记内容。", "");
      return lines.join("\n");
    }
    const pages = /* @__PURE__ */ new Map();
    for (const note of notes) {
      const items = pages.get(note.pageNumber) ?? [];
      items.push(note);
      pages.set(note.pageNumber, items);
    }
    for (const pageNumber of [...pages.keys()].sort((a, b) => a - b)) {
      lines.push(`## 第 ${pageNumber} 页`, "");
      for (const note of pages.get(pageNumber) ?? []) {
        if (note.noteType === "highlight") {
          lines.push("### 文本高亮");
        } else if (note.noteType === "comment") {
          lines.push("### 文本批注");
        } else {
          lines.push("### 公式收藏");
        }
        if (options.includeOriginal && note.selectedText) {
          lines.push(`- 原文：${note.selectedText}`);
        }
        if (options.includeTranslation && note.translatedText) {
          lines.push(`- 译文：${note.translatedText}`);
        }
        if (note.comment) {
          lines.push(`- 批注：${note.comment}`);
        }
        if (note.noteType === "formula_favorite" && note.formulaId) {
          const formula = formulaMap.get(note.formulaId);
          if (options.includeLatex && formula?.latex) {
            lines.push(`- LaTeX：\`${formula.latex}\``);
          }
          if (options.includeExplanation && formula?.explanation) {
            lines.push(`- 解释：${formula.explanation}`);
          }
        }
        lines.push("");
      }
    }
    return lines.join("\n");
  }
}
class MathpixProvider {
  async testConnection(config) {
    const response = await fetch("https://api.mathpix.com/v3/text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        app_id: config.appId,
        app_key: config.appKey
      },
      body: JSON.stringify({
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0r8AAAAASUVORK5CYII=",
        formats: ["text"]
      })
    });
    const responseText = await response.text();
    if (response.ok) {
      return {
        success: true,
        message: "Mathpix 连接正常，鉴权已通过。",
        details: {
          status: response.status
        }
      };
    }
    if (response.status === 400 || response.status === 422) {
      return {
        success: true,
        message: "Mathpix 连接正常，测试请求已到达服务端。",
        details: {
          status: response.status,
          body: responseText.slice(0, 300)
        }
      };
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Mathpix 鉴权失败：${response.status} ${responseText}`);
    }
    if (response.status === 429) {
      throw new Error(`Mathpix 请求被限流：${response.status} ${responseText}`);
    }
    throw new Error(`Mathpix request failed: ${response.status} ${responseText}`);
  }
  async recognizeFormula(config, params) {
    const buffer = await readFile(params.imagePath);
    const extension = extname(params.imagePath).toLowerCase();
    const mimeType = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
    const response = await fetch("https://api.mathpix.com/v3/text", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        app_id: config.appId,
        app_key: config.appKey
      },
      body: JSON.stringify({
        src: `data:${mimeType};base64,${buffer.toString("base64")}`,
        formats: ["latex_styled", "text"]
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Mathpix request failed: ${response.status} ${body}`);
    }
    const data = await response.json();
    const latex = data.latex_styled?.trim() || data.text?.trim();
    if (!latex) {
      throw new Error("Mathpix did not return LaTeX content");
    }
    return {
      latex,
      confidence: data.confidence,
      raw: data
    };
  }
}
class OpenAiCompatibleProvider {
  async translateText(config, params) {
    const content = await this.requestChatCompletion(config, [
      {
        role: "system",
        content: "你是学术论文阅读助手。请只输出译文，保持术语准确、简洁，不要增加解释性前缀。"
      },
      {
        role: "user",
        content: [
          `目标语言：${params.targetLang}`,
          params.context ? `上下文：${params.context}` : void 0,
          "待翻译文本：",
          params.text
        ].filter(Boolean).join("\n\n")
      }
    ]);
    return content.trim();
  }
  async explainFormula(config, params) {
    const content = await this.requestChatCompletion(config, [
      {
        role: "system",
        content: '你是论文公式讲解助手。请仅返回 JSON，不要使用 Markdown 代码块。JSON 结构必须是 {"explanation":"...","variables":[{"symbol":"...","meaning":"..."}]}。'
      },
      {
        role: "user",
        content: [
          "请用中文解释下面的公式，并提取变量含义。",
          `LaTeX: ${params.latex}`,
          params.context ? `上下文：${params.context}` : void 0,
          "要求 explanation 中包含：公式含义、使用场景和简化说明。"
        ].filter(Boolean).join("\n\n")
      }
    ]);
    const parsed = this.parseJsonPayload(content);
    return {
      explanation: parsed?.explanation?.trim() || content.trim(),
      variables: Array.isArray(parsed?.variables) ? parsed.variables : []
    };
  }
  async requestChatCompletion(config, messages) {
    const baseURL = config.baseURL.replace(/\/+$/, "");
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`AI request failed: ${response.status} ${body}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("AI response content is empty");
    }
    return content;
  }
  parseJsonPayload(content) {
    const normalized = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
    try {
      return JSON.parse(normalized);
    } catch {
      return void 0;
    }
  }
}
class Pix2TexProvider {
  async recognizeFormula(config, params) {
    await access(config.scriptPath, constants.R_OK).catch(() => {
      throw new Error(`pix2tex runner 不存在：${config.scriptPath}`);
    });
    const resolvedPythonPath = await this.resolvePythonCommand(config.pythonPath);
    const runnerOutput = await this.runPython(
      {
        ...config,
        pythonPath: resolvedPythonPath
      },
      [params.imagePath]
    );
    if (runnerOutput.error) {
      throw new Error(
        runnerOutput.detail ? `${runnerOutput.error}: ${runnerOutput.detail}` : runnerOutput.error
      );
    }
    const latex = runnerOutput.latex?.trim();
    if (!latex) {
      throw new Error("pix2tex 没有返回 LaTeX 内容");
    }
    return {
      latex,
      raw: runnerOutput
    };
  }
  async testEnvironment(config) {
    await access(config.scriptPath, constants.R_OK).catch(() => {
      throw new Error(`pix2tex runner 不存在：${config.scriptPath}`);
    });
    const resolvedPythonPath = await this.resolvePythonCommand(config.pythonPath);
    const runnerOutput = await this.runPython(
      {
        ...config,
        pythonPath: resolvedPythonPath
      },
      ["--healthcheck"]
    );
    if (runnerOutput.error) {
      throw new Error(
        runnerOutput.detail ? `${runnerOutput.error}: ${runnerOutput.detail}` : runnerOutput.error
      );
    }
    return {
      success: true,
      message: runnerOutput.message ?? "pix2tex 环境检查通过，已成功导入 pix2tex 和 Pillow。",
      details: {
        python: runnerOutput.python,
        pix2texVersion: runnerOutput.pix2texVersion,
        pillowVersion: runnerOutput.pillowVersion
      }
    };
  }
  async resolvePythonCommand(inputPath) {
    const trimmedPath = inputPath.trim();
    if (!trimmedPath) {
      throw new Error("pix2tex Python 路径不能为空");
    }
    if (!looksLikePath(trimmedPath)) {
      return trimmedPath;
    }
    const directStat = await safeStat(trimmedPath);
    if (directStat?.isFile()) {
      return trimmedPath;
    }
    if (directStat?.isDirectory()) {
      const candidates = process.platform === "win32" ? [
        join(trimmedPath, "python.exe"),
        join(trimmedPath, "Scripts", "python.exe"),
        join(trimmedPath, "python")
      ] : [join(trimmedPath, "bin", "python"), join(trimmedPath, "python")];
      for (const candidate of candidates) {
        const candidateStat = await safeStat(candidate);
        if (candidateStat?.isFile()) {
          return candidate;
        }
      }
      throw new Error(
        `pix2tex Python 路径看起来是一个环境目录，但没有找到可执行文件。请填写 python.exe，或直接填写包含 python.exe 的环境目录：${trimmedPath}`
      );
    }
    if (process.platform === "win32" && !basename(trimmedPath).toLowerCase().endsWith(".exe")) {
      const exeCandidate = `${trimmedPath}.exe`;
      const exeStat = await safeStat(exeCandidate);
      if (exeStat?.isFile()) {
        return exeCandidate;
      }
    }
    throw new Error(
      `pix2tex Python 不存在：${trimmedPath}。请填写 python.exe 路径，或直接填写 conda/venv 环境目录。`
    );
  }
  async runPython(config, runnerArgs) {
    return new Promise((resolve, reject) => {
      const child = spawn(config.pythonPath, [config.scriptPath, ...runnerArgs], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8"
        },
        windowsHide: true
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        reject(
          new Error(
            `启动 pix2tex Python 失败：${config.pythonPath}。${error.message}`
          )
        );
      });
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(stderr.trim() || `pix2tex 进程退出码异常：${code ?? "unknown"}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(stdout.trim() || stderr.trim() || "pix2tex 输出无法解析"));
        }
      });
    });
  }
}
function looksLikePath(value) {
  return value.includes("\\") || value.includes("/") || /^[a-zA-Z]:/.test(value);
}
async function safeStat(targetPath) {
  try {
    return await stat(targetPath);
  } catch {
    return null;
  }
}
class SecureSettingsService {
  constructor(filePath) {
    this.filePath = filePath;
  }
  saveAiSecret(apiKey) {
    const store = this.readStore();
    store.ai = { apiKey };
    this.writeStore(store);
  }
  getAiSecret() {
    return this.readStore().ai?.apiKey ?? null;
  }
  saveMathpixSecret(appKey) {
    const store = this.readStore();
    store.mathpix = { appKey };
    this.writeStore(store);
  }
  getMathpixSecret() {
    return this.readStore().mathpix?.appKey ?? null;
  }
  readStore() {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const persisted = JSON.parse(raw);
      if (persisted.encrypted) {
        if (!safeStorage.isEncryptionAvailable()) {
          return {};
        }
        const decrypted = safeStorage.decryptString(Buffer.from(persisted.data, "base64"));
        return JSON.parse(decrypted);
      }
      return JSON.parse(persisted.data);
    } catch {
      return {};
    }
  }
  writeStore(store) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const serialized = JSON.stringify(store);
    const payload = safeStorage.isEncryptionAvailable() ? {
      encrypted: true,
      data: safeStorage.encryptString(serialized).toString("base64")
    } : {
      encrypted: false,
      data: serialized
    };
    writeFileSync(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }
}
class BackendError extends Error {
  constructor(code, message, retryable, details) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.details = details;
    this.name = "BackendError";
  }
}
const AI_META_KEY = "ai.provider.meta";
const MATHPIX_META_KEY = "mathpix.meta";
const PIX2TEX_META_KEY = "pix2tex.meta";
const FORMULA_OCR_META_KEY = "formula.ocr.meta";
const THEME_META_KEY = "ui.theme.meta";
const AUTO_TRANSLATE_META_KEY = "ui.auto-translate.meta";
const DEFAULT_THEME_SETTINGS = {
  accentColor: "#7f4f24"
};
function registerIpcHandlers(options) {
  const documentRepository = new DocumentRepository(options.db);
  const noteRepository = new NoteRepository(options.db);
  const formulaRepository = new FormulaRepository(options.db);
  const libraryRepository = new LibraryRepository(options.db);
  const translationCacheRepository = new TranslationCacheRepository(options.db);
  const activityHistoryRepository = new ActivityHistoryRepository(options.db);
  const settingsRepository = new SettingsRepository(options.db);
  const secureSettingsService = new SecureSettingsService(
    join(options.userDataPath, "secure", "settings.json")
  );
  const aiProvider = new OpenAiCompatibleProvider();
  const mathpixProvider = new MathpixProvider();
  const pix2texProvider = new Pix2TexProvider();
  const markdownExporter = new MarkdownExporter();
  const register = (channel, handler) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, payload) => {
      try {
        const data = await handler(payload, event);
        return { ok: true, data };
      } catch (error) {
        return {
          ok: false,
          error: toAppError(error)
        };
      }
    });
  };
  register(IPC_CHANNELS.APP_GET_LAUNCH_STATE, async () => {
    const latestDocument = documentRepository.getLatestRecentDocument();
    if (!latestDocument) {
      return {
        mode: "library",
        reason: "first_launch"
      };
    }
    try {
      await stat(latestDocument.filePath);
    } catch {
      return {
        mode: "library",
        reason: "missing_recent_document",
        missingFileName: latestDocument.fileName
      };
    }
    return {
      mode: "resume",
      document: await openDocumentRecord(documentRepository, {
        filePath: latestDocument.filePath,
        libraryFolderId: latestDocument.libraryFolderId ?? null
      })
    };
  });
  register(IPC_CHANNELS.SETTINGS_SAVE_AI, (payload) => {
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
      configured: true
    });
    if (nextApiKey) {
      secureSettingsService.saveAiSecret(nextApiKey);
    }
  });
  register(IPC_CHANNELS.SETTINGS_GET_AI, () => {
    const meta = settingsRepository.get(AI_META_KEY);
    const apiKey = secureSettingsService.getAiSecret();
    if (!meta) {
      return null;
    }
    return {
      baseURL: meta.baseURL,
      model: meta.model,
      configured: Boolean(apiKey)
    };
  });
  register(IPC_CHANNELS.SETTINGS_SAVE_MATHPIX, (payload) => {
    assertNonEmptyString(payload.appId, "INVALID_PARAMS", "appId 不能为空");
    const existingAppKey = secureSettingsService.getMathpixSecret();
    const nextAppKey = payload.appKey?.trim();
    if (!nextAppKey && !existingAppKey) {
      throw new BackendError("INVALID_PARAMS", "首次保存 Mathpix 配置时必须填写 App Key");
    }
    settingsRepository.upsert(MATHPIX_META_KEY, {
      appId: payload.appId,
      configured: true
    });
    if (nextAppKey) {
      secureSettingsService.saveMathpixSecret(nextAppKey);
    }
  });
  register(IPC_CHANNELS.SETTINGS_GET_MATHPIX, () => {
    const meta = settingsRepository.get(MATHPIX_META_KEY);
    const appKey = secureSettingsService.getMathpixSecret();
    if (!meta) {
      return null;
    }
    return {
      appId: meta.appId,
      configured: Boolean(appKey)
    };
  });
  register(
    IPC_CHANNELS.SETTINGS_TEST_MATHPIX,
    async (payload) => {
      assertNonEmptyString(payload.appId, "INVALID_PARAMS", "appId 不能为空");
      const appKey = payload.appKey?.trim() || secureSettingsService.getMathpixSecret();
      if (!appKey) {
        throw new BackendError("INVALID_PARAMS", "测试 Mathpix 前请填写 App Key，或先保存已有配置");
      }
      return mathpixProvider.testConnection({
        appId: payload.appId.trim(),
        appKey
      });
    }
  );
  register(IPC_CHANNELS.SETTINGS_SAVE_PIX2TEX, (payload) => {
    assertNonEmptyString(payload.pythonPath, "INVALID_PARAMS", "pythonPath 不能为空");
    settingsRepository.upsert(PIX2TEX_META_KEY, {
      pythonPath: payload.pythonPath.trim(),
      configured: true
    });
  });
  register(IPC_CHANNELS.SETTINGS_GET_PIX2TEX, () => {
    return settingsRepository.get(PIX2TEX_META_KEY);
  });
  register(
    IPC_CHANNELS.SETTINGS_TEST_PIX2TEX,
    async (payload) => {
      assertNonEmptyString(payload.pythonPath, "INVALID_PARAMS", "pythonPath 不能为空");
      return pix2texProvider.testEnvironment({
        pythonPath: payload.pythonPath.trim(),
        scriptPath: join(process.cwd(), "src", "backend", "ocr", "pix2tex_runner.py")
      });
    }
  );
  register(IPC_CHANNELS.SETTINGS_SAVE_FORMULA_OCR, (payload) => {
    if (payload.provider !== "mathpix" && payload.provider !== "pix2tex") {
      throw new BackendError("INVALID_PARAMS", "公式 OCR provider 非法");
    }
    settingsRepository.upsert(FORMULA_OCR_META_KEY, {
      provider: payload.provider
    });
  });
  register(IPC_CHANNELS.SETTINGS_GET_FORMULA_OCR, () => {
    return settingsRepository.get(FORMULA_OCR_META_KEY) ?? {
      provider: "mathpix"
    };
  });
  register(IPC_CHANNELS.SETTINGS_SAVE_THEME, (payload) => {
    if (!isHexColor(payload.accentColor)) {
      throw new BackendError("INVALID_PARAMS", "主题色必须是 #RRGGBB 格式");
    }
    settingsRepository.upsert(THEME_META_KEY, {
      accentColor: payload.accentColor
    });
  });
  register(IPC_CHANNELS.SETTINGS_GET_THEME, () => {
    return settingsRepository.get(THEME_META_KEY) ?? DEFAULT_THEME_SETTINGS;
  });
  register(IPC_CHANNELS.SETTINGS_SAVE_AUTO_TRANSLATE, (payload) => {
    settingsRepository.upsert(AUTO_TRANSLATE_META_KEY, {
      enabled: Boolean(payload.enabled)
    });
  });
  register(
    IPC_CHANNELS.SETTINGS_GET_AUTO_TRANSLATE,
    () => {
      return settingsRepository.get(AUTO_TRANSLATE_META_KEY) ?? {
        enabled: false
      };
    }
  );
  register(IPC_CHANNELS.DIALOG_PICK_PDF, async (_payload, event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender) ?? void 0;
    const dialogOptions = {
      title: "选择 PDF 文件",
      defaultPath: options.documentsPath,
      properties: ["openFile"],
      filters: [{ name: "PDF", extensions: ["pdf"] }]
    };
    const result = ownerWindow ? await dialog.showOpenDialog(ownerWindow, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    return {
      canceled: result.canceled,
      filePath: result.filePaths[0]
    };
  });
  register(IPC_CHANNELS.DOCUMENT_OPEN, async (payload) => {
    assertNonEmptyString(payload.filePath, "INVALID_PARAMS", "filePath 不能为空");
    return openDocumentRecord(documentRepository, payload);
  });
  register(
    IPC_CHANNELS.DOCUMENT_LIST_RECENT,
    () => documentRepository.listRecentDocuments()
  );
  register(IPC_CHANNELS.LIBRARY_LIST_SNAPSHOT, () => ({
    folders: libraryRepository.listFolders(),
    documents: documentRepository.listLibraryDocuments()
  }));
  register(
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
        parentId: payload.parentId ?? null
      });
    }
  );
  register(
    IPC_CHANNELS.LIBRARY_RENAME_FOLDER,
    (payload) => {
      assertNonEmptyString(payload.folderId, "INVALID_PARAMS", "folderId 不能为空");
      assertNonEmptyString(payload.name, "INVALID_PARAMS", "folder name 不能为空");
      const folder = libraryRepository.renameFolder(payload.folderId, payload.name.trim());
      if (!folder) {
        throw new BackendError("NOT_FOUND", "要重命名的文件夹不存在");
      }
      return folder;
    }
  );
  register(IPC_CHANNELS.LIBRARY_MOVE_DOCUMENT, (payload) => {
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
  register(
    IPC_CHANNELS.DOCUMENT_READ_BINARY,
    async (payload) => {
      assertNonEmptyString(payload.filePath, "INVALID_PARAMS", "filePath 不能为空");
      const bytes = await readFile(payload.filePath);
      const view = new Uint8Array(bytes);
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
  );
  register(
    IPC_CHANNELS.DOCUMENT_UPDATE_PROGRESS,
    (payload) => {
      assertNonEmptyString(payload.documentId, "INVALID_PARAMS", "documentId 不能为空");
      documentRepository.touchRecentDocument({
        documentId: payload.documentId,
        lastPage: payload.lastPage,
        lastZoom: payload.lastZoom,
        scrollTopRatio: payload.scrollTopRatio
      });
    }
  );
  register(IPC_CHANNELS.TRANSLATE_TEXT, async (payload) => {
    assertNonEmptyString(payload.documentId, "INVALID_PARAMS", "documentId 不能为空");
    assertNonEmptyString(payload.text, "INVALID_PARAMS", "text 不能为空");
    assertNonEmptyString(payload.targetLang, "INVALID_PARAMS", "targetLang 不能为空");
    const aiConfig = getAiRuntimeConfig(settingsRepository, secureSettingsService);
    const cacheKey = createHash("sha256").update([payload.text, payload.targetLang, aiConfig.model].join("\n")).digest("hex");
    const cached = translationCacheRepository.getByCacheKey(cacheKey);
    if (cached) {
      return {
        translatedText: cached.translatedText,
        cached: true,
        model: cached.modelName
      };
    }
    const translatedText = await aiProvider.translateText(aiConfig, payload);
    translationCacheRepository.save({
      cacheKey,
      sourceText: payload.text,
      targetLang: payload.targetLang,
      translatedText,
      modelName: aiConfig.model
    });
    activityHistoryRepository.log({
      documentId: payload.documentId,
      actionType: "translate_text",
      payload: {
        pageNumber: payload.pageNumber,
        sourcePreview: payload.text.slice(0, 120)
      }
    });
    return {
      translatedText,
      cached: false,
      model: aiConfig.model
    };
  });
  register(
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
      const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
      const directory = join(options.userDataPath, "formula-images", payload.documentId);
      await mkdir(directory, { recursive: true });
      const imagePath = join(directory, `${payload.pageNumber}-${Date.now()}.${extension}`);
      await writeFile(imagePath, Buffer.from(base64Data, "base64"));
      return { imagePath };
    }
  );
  register(
    IPC_CHANNELS.FORMULA_RECOGNIZE,
    async (payload) => {
      assertNonEmptyString(payload.documentId, "INVALID_PARAMS", "documentId 不能为空");
      assertNonEmptyString(payload.imagePath, "INVALID_PARAMS", "imagePath 不能为空");
      const formulaOcrProvider = getFormulaOcrProvider(settingsRepository);
      const recognition = formulaOcrProvider === "pix2tex" ? await pix2texProvider.recognizeFormula(getPix2TexRuntimeConfig(settingsRepository), {
        imagePath: payload.imagePath
      }) : await mathpixProvider.recognizeFormula(
        getMathpixRuntimeConfig(settingsRepository, secureSettingsService),
        {
          imagePath: payload.imagePath
        }
      );
      const formula = formulaRepository.create({
        documentId: payload.documentId,
        pageNumber: payload.pageNumber,
        bbox: payload.bbox,
        imagePath: payload.imagePath,
        latex: recognition.latex,
        confidence: recognition.confidence,
        ocrProvider: formulaOcrProvider,
        sourceContext: payload.sourceContext
      });
      activityHistoryRepository.log({
        documentId: payload.documentId,
        actionType: "recognize_formula",
        payload: {
          pageNumber: payload.pageNumber,
          formulaId: formula.id,
          latex: recognition.latex
        }
      });
      return {
        formulaId: formula.id,
        latex: recognition.latex,
        confidence: recognition.confidence,
        ocrProvider: formulaOcrProvider
      };
    }
  );
  register(
    IPC_CHANNELS.FORMULA_EXPLAIN,
    async (payload) => {
      assertNonEmptyString(payload.formulaId, "INVALID_PARAMS", "formulaId 不能为空");
      assertNonEmptyString(payload.latex, "INVALID_PARAMS", "latex 不能为空");
      const aiConfig = getAiRuntimeConfig(settingsRepository, secureSettingsService);
      const result = await aiProvider.explainFormula(aiConfig, {
        latex: payload.latex,
        context: payload.context
      });
      formulaRepository.updateExplanation(payload.formulaId, result.explanation, result.variables);
      const formula = formulaRepository.getById(payload.formulaId);
      activityHistoryRepository.log({
        documentId: formula?.documentId,
        actionType: "explain_formula",
        payload: {
          formulaId: payload.formulaId,
          latex: payload.latex
        }
      });
      return result;
    }
  );
  register(IPC_CHANNELS.NOTE_SAVE, (payload) => {
    assertNonEmptyString(payload.documentId, "INVALID_PARAMS", "documentId 不能为空");
    const note = noteRepository.save(payload);
    activityHistoryRepository.log({
      documentId: payload.documentId,
      actionType: "save_note",
      payload: {
        noteId: note.id,
        noteType: payload.noteType,
        pageNumber: payload.pageNumber
      }
    });
    return { noteId: note.id };
  });
  register(
    IPC_CHANNELS.NOTE_LIST_BY_DOCUMENT,
    (payload) => {
      assertNonEmptyString(payload.documentId, "INVALID_PARAMS", "documentId 不能为空");
      return noteRepository.listByDocument(payload.documentId);
    }
  );
  register(IPC_CHANNELS.NOTE_DELETE, (payload) => {
    assertNonEmptyString(payload.noteId, "INVALID_PARAMS", "noteId 不能为空");
    noteRepository.delete(payload.noteId);
  });
  register(
    IPC_CHANNELS.FORMULA_LIST_BY_DOCUMENT,
    (payload) => {
      assertNonEmptyString(payload.documentId, "INVALID_PARAMS", "documentId 不能为空");
      return formulaRepository.listByDocument(payload.documentId);
    }
  );
  register(
    IPC_CHANNELS.FORMULA_GET_BY_ID,
    (payload) => {
      assertNonEmptyString(payload.formulaId, "INVALID_PARAMS", "formulaId 不能为空");
      return formulaRepository.getById(payload.formulaId);
    }
  );
  register(
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
        defaultDirectory: options.documentsPath
      });
      activityHistoryRepository.log({
        documentId: payload.documentId,
        actionType: "export_markdown",
        payload: {
          outputPath: result.outputPath,
          noteCount: result.noteCount,
          formulaCount: result.formulaCount
        }
      });
      return result;
    }
  );
  register(
    IPC_CHANNELS.HISTORY_LIST,
    (payload) => activityHistoryRepository.list(payload)
  );
}
function getAiRuntimeConfig(settingsRepository, secureSettingsService) {
  const meta = settingsRepository.get(AI_META_KEY);
  const apiKey = secureSettingsService.getAiSecret();
  if (!meta?.baseURL || !meta.model || !apiKey) {
    throw new BackendError(
      "UNAUTHORIZED",
      "AI 配置不完整，请先在设置页填写 baseURL、API Key 和 model"
    );
  }
  return {
    baseURL: meta.baseURL.replace(/\/+$/, ""),
    apiKey,
    model: meta.model
  };
}
function getMathpixRuntimeConfig(settingsRepository, secureSettingsService) {
  const meta = settingsRepository.get(MATHPIX_META_KEY);
  const appKey = secureSettingsService.getMathpixSecret();
  if (!meta?.appId || !appKey) {
    throw new BackendError("UNAUTHORIZED", "Mathpix 配置不完整，请先填写 appId 和 appKey");
  }
  return {
    appId: meta.appId,
    appKey
  };
}
function getPix2TexRuntimeConfig(settingsRepository) {
  const meta = settingsRepository.get(PIX2TEX_META_KEY);
  if (!meta?.pythonPath) {
    throw new BackendError(
      "UNAUTHORIZED",
      "pix2tex 配置不完整，请先填写 Python 路径并确认该环境已安装 pix2tex"
    );
  }
  return {
    pythonPath: meta.pythonPath,
    scriptPath: join(process.cwd(), "src", "backend", "ocr", "pix2tex_runner.py")
  };
}
function getFormulaOcrProvider(settingsRepository) {
  const meta = settingsRepository.get(FORMULA_OCR_META_KEY);
  return meta?.provider ?? "mathpix";
}
async function openDocumentRecord(documentRepository, payload) {
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
    libraryFolderId: payload.libraryFolderId
  });
  const recentState = documentRepository.getRecentState(document.id);
  documentRepository.touchRecentDocument({
    documentId: document.id,
    lastPage: recentState?.last_page ?? 1,
    lastZoom: recentState?.last_zoom ?? 1,
    scrollTopRatio: recentState?.scroll_top_ratio ?? void 0
  });
  const latestRecentState = documentRepository.getRecentState(document.id);
  return {
    documentId: document.id,
    fileName: document.fileName,
    filePath: document.filePath,
    pageCount: document.pageCount,
    libraryFolderId: document.libraryFolderId ?? null,
    lastPage: latestRecentState?.last_page,
    lastZoom: latestRecentState?.last_zoom
  };
}
function assertNonEmptyString(value, code, message) {
  if (!value || !value.trim()) {
    throw new BackendError(code, message);
  }
}
function isHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}
function toAppError(error) {
  if (error instanceof BackendError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details
    };
  }
  if (error instanceof Error) {
    return {
      code: normalizeUnknownErrorCode(error.message),
      message: error.message,
      retryable: false
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: "Unknown error",
    retryable: false
  };
}
function normalizeUnknownErrorCode(message) {
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
async function computeFileHash(filePath) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
let databaseClient = null;
const currentDir = dirname(fileURLToPath(import.meta.url));
function sendAppMenuAction(window, action) {
  window.webContents.send(IPC_CHANNELS.APP_MENU_ACTION, action);
}
function buildApplicationMenu(window) {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "打开文件",
          accelerator: "CmdOrCtrl+O",
          click: () => sendAppMenuAction(window, "open_file")
        },
        {
          label: "论文仓库",
          accelerator: "CmdOrCtrl+L",
          click: () => sendAppMenuAction(window, "open_library")
        }
      ]
    },
    {
      label: "设置",
      submenu: [
        {
          label: "打开设置",
          accelerator: "CmdOrCtrl+,",
          click: () => sendAppMenuAction(window, "open_settings")
        }
      ]
    },
    {
      label: "视图",
      submenu: [
        {
          label: "搜索",
          accelerator: "CmdOrCtrl+F",
          click: () => sendAppMenuAction(window, "toggle_search")
        },
        {
          label: "显示/隐藏目录",
          accelerator: "CmdOrCtrl+1",
          click: () => sendAppMenuAction(window, "toggle_sidebar")
        },
        {
          label: "显示/隐藏 AI 面板",
          accelerator: "CmdOrCtrl+2",
          click: () => sendAppMenuAction(window, "toggle_ai_panel")
        },
        { type: "separator" },
        {
          label: "恢复 100% 缩放",
          accelerator: "CmdOrCtrl+0",
          click: () => sendAppMenuAction(window, "reset_zoom")
        },
        { type: "separator" },
        {
          label: "上一页",
          accelerator: "Left",
          click: () => sendAppMenuAction(window, "previous_page")
        },
        {
          label: "下一页",
          accelerator: "Right",
          click: () => sendAppMenuAction(window, "next_page")
        }
      ]
    }
  ];
  return Menu.buildFromTemplate(template);
}
function createMainWindow() {
  const window = new BrowserWindow({
    show: true,
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "PDF 智能阅读器",
    backgroundColor: "#f5f0e8",
    webPreferences: {
      preload: join(currentDir, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[main] did-fail-load", {
      errorCode,
      errorDescription,
      validatedURL
    });
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[main] render-process-gone", details);
  });
  window.webContents.setZoomFactor(1);
  void window.webContents.setVisualZoomLevelLimits(1, 1).catch((error) => {
    console.error("[main] setVisualZoomLevelLimits failed", error);
  });
  window.webContents.on("zoom-changed", (event) => {
    event.preventDefault();
    window.webContents.setZoomFactor(1);
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    const indexPath = join(currentDir, "../renderer/index.html");
    void window.loadFile(indexPath);
  }
  window.setMenu(buildApplicationMenu(window));
  return window;
}
async function bootstrap() {
  await app.whenReady();
  const dbPath = join(app.getPath("userData"), "pdf-reader-v1.sqlite");
  databaseClient = new DatabaseClient(dbPath);
  runMigrations(databaseClient.connection);
  registerIpcHandlers({
    db: databaseClient.connection,
    userDataPath: app.getPath("userData"),
    documentsPath: app.getPath("documents")
  });
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
app.on("before-quit", () => {
  databaseClient?.close();
});
void bootstrap().catch((error) => {
  console.error("[main] bootstrap failed", error);
  app.exit(1);
});
