PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS formulas_v2 (
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

INSERT INTO formulas_v2 (
  id,
  document_id,
  page_number,
  bbox_json,
  image_path,
  latex,
  explanation,
  variables_json,
  confidence,
  ocr_provider,
  source_context,
  created_at,
  updated_at
)
SELECT
  id,
  document_id,
  page_number,
  bbox_json,
  image_path,
  latex,
  explanation,
  variables_json,
  confidence,
  ocr_provider,
  source_context,
  created_at,
  updated_at
FROM formulas;

DROP TABLE formulas;

ALTER TABLE formulas_v2 RENAME TO formulas;

CREATE INDEX IF NOT EXISTS idx_formulas_document_page
ON formulas(document_id, page_number);

PRAGMA foreign_keys = ON;
