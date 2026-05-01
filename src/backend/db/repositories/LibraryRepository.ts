import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type { LibraryFolderItem } from "@shared/types";

type LibraryFolderRow = {
  id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
  document_count: number;
};

export class LibraryRepository {
  constructor(private readonly db: Database.Database) {}

  listFolders(): LibraryFolderItem[] {
    const rows = this.db
      .prepare(`
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
      `)
      .all() as LibraryFolderRow[];

    return rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      documentCount: row.document_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getFolderById(folderId: string): LibraryFolderItem | null {
    const row = this.db
      .prepare(`
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
      `)
      .get(folderId) as LibraryFolderRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      documentCount: row.document_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createFolder(params: { name: string; parentId?: string | null }): LibraryFolderItem {
    const now = new Date().toISOString();
    const folderId = randomUUID();

    this.db
      .prepare(`
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
      `)
      .run({
        id: folderId,
        parent_id: params.parentId ?? null,
        name: params.name,
        created_at: now,
        updated_at: now,
      });

    return {
      id: folderId,
      parentId: params.parentId ?? null,
      name: params.name,
      documentCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  renameFolder(folderId: string, name: string): LibraryFolderItem | null {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(`
        UPDATE library_folders
        SET name = @name,
            updated_at = @updated_at
        WHERE id = @id
      `)
      .run({
        id: folderId,
        name,
        updated_at: now,
      });

    if (result.changes === 0) {
      return null;
    }

    return this.getFolderById(folderId);
  }
}
