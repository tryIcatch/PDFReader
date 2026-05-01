import type { NoteItem, SaveNoteParams, SaveNoteResult } from "@shared/types";

import { getDesktopApi } from "./desktopApi";

export const noteService = {
  saveNote(params: SaveNoteParams): Promise<SaveNoteResult> {
    return getDesktopApi().saveNote(params);
  },

  listByDocument(documentId: string): Promise<NoteItem[]> {
    return getDesktopApi().listNotesByDocument(documentId);
  },

  deleteNote(noteId: string): Promise<void> {
    return getDesktopApi().deleteNote(noteId);
  },
};
