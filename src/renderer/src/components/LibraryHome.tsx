import { useMemo, useState } from "react";

import type {
  LibraryDocumentItem,
  LibraryFolderItem,
  LibrarySnapshot,
  RecentDocumentItem,
} from "@shared/types";

type LibraryHomeProps = {
  snapshot: LibrarySnapshot;
  recentDocuments: RecentDocumentItem[];
  selectedFolderId: string | null;
  launchMessage?: string;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (name: string, parentId: string | null) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onImportIntoCurrentFolder: () => void;
  onOpenDocument: (document: LibraryDocumentItem) => void;
  onOpenRecent: (document: RecentDocumentItem) => void;
  onMoveDocument: (documentId: string, folderId: string | null) => void;
};

type FlattenedFolder = {
  id: string;
  name: string;
  depth: number;
};

export function LibraryHome(props: LibraryHomeProps) {
  const [createMode, setCreateMode] = useState(false);
  const [renameMode, setRenameMode] = useState(false);
  const [draftName, setDraftName] = useState("");

  const selectedFolder = props.snapshot.folders.find((item) => item.id === props.selectedFolderId) ?? null;
  const flattenedFolders = useMemo(
    () => flattenFolders(props.snapshot.folders, null, 0),
    [props.snapshot.folders],
  );
  const visibleDocuments = useMemo(() => {
    if (!props.selectedFolderId) {
      return props.snapshot.documents;
    }

    return props.snapshot.documents.filter(
      (document) => (document.libraryFolderId ?? null) === props.selectedFolderId,
    );
  }, [props.selectedFolderId, props.snapshot.documents]);

  const pathLabel = selectedFolder
    ? buildFolderPathLabel(selectedFolder.id, props.snapshot.folders)
    : "全部论文";

  function startCreateFolder() {
    setCreateMode(true);
    setRenameMode(false);
    setDraftName("");
  }

  function startRenameFolder() {
    if (!selectedFolder) {
      return;
    }

    setRenameMode(true);
    setCreateMode(false);
    setDraftName(selectedFolder.name);
  }

  function submitFolderDraft() {
    const nextName = draftName.trim();
    if (!nextName) {
      return;
    }

    if (renameMode && selectedFolder) {
      props.onRenameFolder(selectedFolder.id, nextName);
    } else {
      props.onCreateFolder(nextName, props.selectedFolderId);
    }

    setCreateMode(false);
    setRenameMode(false);
    setDraftName("");
  }

  return (
    <section className="library-shell">
      <aside className="library-tree">
        <div className="library-tree-header">
          <p className="eyebrow">Repository</p>
          <h2>论文仓库</h2>
          <p className="muted">按主题、项目或研究方向整理论文，之后继续阅读会更顺手。</p>
        </div>

        <div className="library-tree-actions">
          <button className="secondary" onClick={startCreateFolder}>
            新建文件夹
          </button>
          <button className="secondary" disabled={!selectedFolder} onClick={startRenameFolder}>
            重命名
          </button>
        </div>

        {(createMode || renameMode) ? (
          <div className="library-folder-editor">
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder={renameMode ? "输入新的文件夹名称" : "输入文件夹名称"}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitFolderDraft();
                }

                if (event.key === "Escape") {
                  setCreateMode(false);
                  setRenameMode(false);
                  setDraftName("");
                }
              }}
            />
            <div className="library-folder-editor-actions">
              <button onClick={submitFolderDraft}>{renameMode ? "保存" : "创建"}</button>
              <button
                className="secondary"
                onClick={() => {
                  setCreateMode(false);
                  setRenameMode(false);
                  setDraftName("");
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}

        <div className="library-tree-section">
          <button
            className={
              props.selectedFolderId === null
                ? "library-tree-item library-tree-item--active"
                : "library-tree-item"
            }
            onClick={() => props.onSelectFolder(null)}
          >
            <span>全部论文</span>
            <strong>{props.snapshot.documents.length}</strong>
          </button>

          {flattenedFolders.map((folder) => {
            const folderInfo = props.snapshot.folders.find((item) => item.id === folder.id);
            return (
              <button
                key={folder.id}
                className={
                  folder.id === props.selectedFolderId
                    ? "library-tree-item library-tree-item--active"
                    : "library-tree-item"
                }
                onClick={() => props.onSelectFolder(folder.id)}
                style={{ paddingLeft: `${16 + folder.depth * 18}px` }}
                title={folder.name}
              >
                <span>{folder.name}</span>
                <strong>{folderInfo?.documentCount ?? 0}</strong>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="library-content">
        <div className="library-hero">
          <div>
            <p className="eyebrow">Library</p>
            <h1>{pathLabel}</h1>
            <p className="summary">
              这里会保存你导入过的论文和分类结构。打开软件时，如果上次阅读的论文还在，就会直接回到上次的位置。
            </p>
          </div>

          <div className="library-hero-actions">
            <button onClick={props.onImportIntoCurrentFolder}>
              导入 PDF{selectedFolder ? ` 到「${selectedFolder.name}」` : ""}
            </button>
          </div>
        </div>

        {props.launchMessage ? <div className="library-notice">{props.launchMessage}</div> : null}

        {props.recentDocuments.length > 0 ? (
          <section className="library-recent-strip">
            <div className="library-section-head">
              <h3>继续阅读</h3>
              <span>{props.recentDocuments.length} 条最近记录</span>
            </div>
            <div className="library-recent-list">
              {props.recentDocuments.slice(0, 3).map((document) => (
                <button
                  key={document.documentId}
                  className="library-recent-card"
                  onClick={() => props.onOpenRecent(document)}
                  title={document.fileName}
                >
                  <strong>{document.fileName}</strong>
                  <span>
                    第 {document.lastPage} 页 · {new Date(document.lastOpenTime).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="library-documents">
          <div className="library-section-head">
            <h3>{selectedFolder ? `${selectedFolder.name} 中的论文` : "全部论文"}</h3>
            <span>{visibleDocuments.length} 篇</span>
          </div>

          {visibleDocuments.length > 0 ? (
            <div className="library-document-grid">
              {visibleDocuments.map((document) => (
                <article key={document.documentId} className="library-document-card">
                  <div className="library-document-copy">
                    <h4 title={document.fileName}>{document.fileName}</h4>
                    <p title={document.filePath}>{document.filePath}</p>
                    <div className="library-document-meta">
                      <span>页数 {document.pageCount || "待解析"}</span>
                      <span>
                        {document.lastOpenTime
                          ? `上次阅读 ${new Date(document.lastOpenTime).toLocaleString()}`
                          : "尚未开始阅读"}
                      </span>
                    </div>
                  </div>

                  <div className="library-document-actions">
                    <button onClick={() => props.onOpenDocument(document)}>打开</button>
                    <label className="library-move-select">
                      <span>归档到</span>
                      <select
                        value={document.libraryFolderId ?? "__root__"}
                        onChange={(event) =>
                          props.onMoveDocument(
                            document.documentId,
                            event.target.value === "__root__" ? null : event.target.value,
                          )
                        }
                      >
                        <option value="__root__">未归档 / 根层</option>
                        {flattenedFolders.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {`${"　".repeat(folder.depth)}${folder.name}`}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="library-empty">
              <p>当前分类下还没有论文。</p>
              <button onClick={props.onImportIntoCurrentFolder}>导入第一篇 PDF</button>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function flattenFolders(
  folders: LibraryFolderItem[],
  parentId: string | null,
  depth: number,
): FlattenedFolder[] {
  const children = folders
    .filter((folder) => (folder.parentId ?? null) === parentId)
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

  return children.flatMap((folder) => [
    { id: folder.id, name: folder.name, depth },
    ...flattenFolders(folders, folder.id, depth + 1),
  ]);
}

function buildFolderPathLabel(folderId: string, folders: LibraryFolderItem[]): string {
  const chain: string[] = [];
  let currentFolder = folders.find((folder) => folder.id === folderId) ?? null;

  while (currentFolder) {
    chain.unshift(currentFolder.name);
    currentFolder = currentFolder.parentId
      ? folders.find((folder) => folder.id === currentFolder?.parentId) ?? null
      : null;
  }

  return ["论文仓库", ...chain].join(" / ");
}
