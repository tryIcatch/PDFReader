import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type { NoteItem, SaveNoteParams } from "@shared/types";

import { parseJson, stringifyJson } from "../../utils/json";

type NoteRow = {
  id: string;
  document_id: string;
  page_number: number;
  note_type: NoteItem["noteType"];
  selected_text: string | null;
  translated_text: string | null;
  comment: string | null;
  color: string | null;
  anchor_json: string | null;
  rects_json: string | null;
  formula_id: string | null;
  created_at: string;
  updated_at: string;
};

export class NoteRepository {
  constructor(private readonly db: Database.Database) {}

  save(params: SaveNoteParams): NoteItem {
    const now = new Date().toISOString();
    const note: NoteItem = {
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
      updatedAt: now,
    };

    this.db
      .prepare(`
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
      `)
      .run({
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
        updated_at: note.updatedAt,
      });

    return note;
  }

  listByDocument(documentId: string): NoteItem[] {
    const rows = this.db
      .prepare(`
        SELECT *
        FROM notes
        WHERE document_id = ?
        ORDER BY page_number ASC, created_at DESC
      `)
      .all(documentId) as NoteRow[];

    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      pageNumber: row.page_number,
      noteType: row.note_type,
      selectedText: row.selected_text ?? undefined,
      translatedText: row.translated_text ?? undefined,
      comment: row.comment ?? undefined,
      color: row.color ?? undefined,
      anchorJson: parseJson(row.anchor_json),
      rectsJson: parseJson(row.rects_json),
      formulaId: row.formula_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  delete(noteId: string): void {
    this.db.prepare("DELETE FROM notes WHERE id = ?").run(noteId);
  }
}
