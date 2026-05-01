PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,
  file_size INTEGER NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_file_name
ON documents(file_name);

CREATE TABLE IF NOT EXISTS formulas (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  bbox_json TEXT NOT NULL,
  image_path TEXT NOT NULL,
  latex TEXT,
  explanation TEXT,
  variables_json TEXT,
  confidence REAL,
  ocr_provider TEXT NOT NULL DEFAULT 'mathpix' CHECK(ocr_provider IN ('mathpix', 'pix2tex')),
  source_context TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_formulas_document_page
ON formulas(document_id, page_number);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  note_type TEXT NOT NULL CHECK(note_type IN ('highlight', 'comment', 'formula_favorite')),
  selected_text TEXT,
  translated_text TEXT,
  comment TEXT,
  color TEXT,
  anchor_json TEXT,
  rects_json TEXT,
  formula_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY(formula_id) REFERENCES formulas(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_document_page
ON notes(document_id, page_number);

CREATE INDEX IF NOT EXISTS idx_notes_type
ON notes(note_type);

CREATE TABLE IF NOT EXISTS recent_documents (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  last_open_time TEXT NOT NULL,
  last_page INTEGER NOT NULL DEFAULT 1,
  last_zoom REAL NOT NULL DEFAULT 1,
  scroll_top_ratio REAL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recent_documents_document_id
ON recent_documents(document_id);

CREATE INDEX IF NOT EXISTS idx_recent_documents_last_open_time
ON recent_documents(last_open_time DESC);

CREATE TABLE IF NOT EXISTS translation_cache (
  id TEXT PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  source_text TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  translated_text TEXT NOT NULL,
  model_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_history (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  action_type TEXT NOT NULL CHECK(
    action_type IN (
      'translate_text',
      'recognize_formula',
      'explain_formula',
      'save_note',
      'export_markdown'
    )
  ),
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_history_action_time
ON activity_history(action_type, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
