import type {
  CreateLibraryFolderParams,
  LibrarySnapshot,
  RenameLibraryFolderParams,
  MoveDocumentToFolderParams,
  LibraryFolderItem,
} from "@shared/types";

import { getDesktopApi } from "./desktopApi";

export const libraryService = {
  listSnapshot(): Promise<LibrarySnapshot> {
    return getDesktopApi().listLibrarySnapshot();
  },

  createFolder(params: CreateLibraryFolderParams): Promise<LibraryFolderItem> {
    return getDesktopApi().createLibraryFolder(params);
  },

  renameFolder(params: RenameLibraryFolderParams): Promise<LibraryFolderItem> {
    return getDesktopApi().renameLibraryFolder(params);
  },

  moveDocumentToFolder(params: MoveDocumentToFolderParams): Promise<void> {
    return getDesktopApi().moveDocumentToFolder(params);
  },
};
