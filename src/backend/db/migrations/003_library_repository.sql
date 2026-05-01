CREATE TABLE IF NOT EXISTS library_folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(parent_id) REFERENCES library_folders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_library_folders_parent_id
ON library_folders(parent_id);

ALTER TABLE documents
ADD COLUMN library_folder_id TEXT REFERENCES library_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_library_folder_id
ON documents(library_folder_id);
