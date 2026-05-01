import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type { LibraryDocumentItem, RecentDocumentItem } from "@shared/types";

export type DocumentRecord = {
  id: string;
  filePath: string;
  fileName: string;
  fileHash: string;
  fileSize: number;
  pageCount: number;
  libraryFolderId?: string | null;
  createdAt: string;
  updatedAt: string;
};

type DocumentRow = {
  id: string;
  file_path: string;
  file_name: string;
  file_hash: string;
  file_size: number;
  page_count: number;
  library_folder_id: string | null;
  created_at: string;
  updated_at: string;
};

type RecentStateRow = {
  last_open_time: string;
  last_page: number;
  last_zoom: number;
  scroll_top_ratio: number | null;
};

export class DocumentRepository {
  constructor(private readonly db: Database.Database) {}

  upsertDocument(params: {
    filePath: string;
    fileName: string;
    fileHash: string;
    fileSize: number;
    pageCount?: number;
    libraryFolderId?: string | null;
  }): DocumentRecord {
    const existing = this.db
      .prepare("SELECT * FROM documents WHERE file_hash = ?")
      .get(params.fileHash) as DocumentRow | undefined;

    const now = new Date().toISOString();
    const pageCount = params.pageCount ?? existing?.page_count ?? 0;

    if (existing) {
      this.db
        .prepare(`
          UPDATE documents
          SET file_path = @file_path,
              file_name = @file_name,
              file_size = @file_size,
              page_count = @page_count,
              library_folder_id = @library_folder_id,
              updated_at = @updated_at
          WHERE id = @id
        `)
        .run({
          id: existing.id,
          file_path: params.filePath,
          file_name: params.fileName,
          file_size: params.fileSize,
          page_count: pageCount,
          library_folder_id:
            params.libraryFolderId === undefined ? existing.library_folder_id : params.libraryFolderId,
          updated_at: now,
        });

      return {
        id: existing.id,
        filePath: params.filePath,
        fileName: params.fileName,
        fileHash: params.fileHash,
        fileSize: params.fileSize,
        pageCount,
        libraryFolderId:
          params.libraryFolderId === undefined ? existing.library_folder_id : params.libraryFolderId,
        createdAt: existing.created_at,
        updatedAt: now,
      };
    }

    const record: DocumentRecord = {
      id: randomUUID(),
      filePath: params.filePath,
      fileName: params.fileName,
      fileHash: params.fileHash,
      fileSize: params.fileSize,
      pageCount,
      libraryFolderId: params.libraryFolderId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(`
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
      `)
      .run({
        id: record.id,
        file_path: record.filePath,
        file_name: record.fileName,
        file_hash: record.fileHash,
        file_size: record.fileSize,
        page_count: record.pageCount,
        library_folder_id: record.libraryFolderId ?? null,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      });

    return record;
  }

  getById(documentId: string): DocumentRecord | null {
    const row = this.db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId) as
      | DocumentRow
      | undefined;

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
      updatedAt: row.updated_at,
    };
  }

  getRecentState(documentId: string): RecentStateRow | null {
    const row = this.db
      .prepare("SELECT * FROM recent_documents WHERE document_id = ?")
      .get(documentId) as RecentStateRow | undefined;

    return row ?? null;
  }

  touchRecentDocument(params: {
    documentId: string;
    lastPage: number;
    lastZoom: number;
    scrollTopRatio?: number;
  }): void {
    const existing = this.getRecentState(params.documentId);
    const now = new Date().toISOString();

    if (existing) {
      this.db
        .prepare(`
          UPDATE recent_documents
          SET last_open_time = @last_open_time,
              last_page = @last_page,
              last_zoom = @last_zoom,
              scroll_top_ratio = @scroll_top_ratio
          WHERE document_id = @document_id
        `)
        .run({
          document_id: params.documentId,
          last_open_time: now,
          last_page: params.lastPage,
          last_zoom: params.lastZoom,
          scroll_top_ratio: params.scrollTopRatio ?? null,
        });
      return;
    }

    this.db
      .prepare(`
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
      `)
      .run({
        id: randomUUID(),
        document_id: params.documentId,
        last_open_time: now,
        last_page: params.lastPage,
        last_zoom: params.lastZoom,
        scroll_top_ratio: params.scrollTopRatio ?? null,
      });
  }

  listRecentDocuments(): RecentDocumentItem[] {
    const rows = this.db
      .prepare(`
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
      `)
      .all() as Array<{
      document_id: string;
      file_name: string;
      file_path: string;
      page_count: number;
      library_folder_id: string | null;
      last_open_time: string;
      last_page: number;
      last_zoom: number;
    }>;

    return rows.map((row) => ({
      documentId: row.document_id,
      fileName: row.file_name,
      filePath: row.file_path,
      pageCount: row.page_count,
      libraryFolderId: row.library_folder_id,
      lastOpenTime: row.last_open_time,
      lastPage: row.last_page,
      lastZoom: row.last_zoom,
    }));
  }

  listLibraryDocuments(): LibraryDocumentItem[] {
    const rows = this.db
      .prepare(`
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
      `)
      .all() as Array<{
      document_id: string;
      file_name: string;
      file_path: string;
      page_count: number;
      library_folder_id: string | null;
      last_open_time: string | null;
      last_page: number | null;
      last_zoom: number | null;
    }>;

    return rows.map((row) => ({
      documentId: row.document_id,
      fileName: row.file_name,
      filePath: row.file_path,
      pageCount: row.page_count,
      libraryFolderId: row.library_folder_id,
      lastOpenTime: row.last_open_time ?? undefined,
      lastPage: row.last_page ?? undefined,
      lastZoom: row.last_zoom ?? undefined,
    }));
  }

  moveDocumentToFolder(documentId: string, folderId?: string | null): void {
    this.db
      .prepare(`
        UPDATE documents
        SET library_folder_id = @library_folder_id,
            updated_at = @updated_at
        WHERE id = @document_id
      `)
      .run({
        document_id: documentId,
        library_folder_id: folderId ?? null,
        updated_at: new Date().toISOString(),
      });
  }

  getLatestRecentDocument(): RecentDocumentItem | null {
    return this.listRecentDocuments()[0] ?? null;
  }
}
