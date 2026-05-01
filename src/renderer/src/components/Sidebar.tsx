import type { RecentDocumentItem } from "@shared/types";

import type { ReaderSearchResult } from "../types/reader";

type SidebarProps = {
  recentDocuments: RecentDocumentItem[];
  searchQuery: string;
  searchResults: ReaderSearchResult[];
  activeSearchIndex: number;
  onOpenRecent: (item: RecentDocumentItem) => void;
  onOpenSearchResult: (result: ReaderSearchResult, index: number) => void;
};

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="sidebar">
      {props.searchQuery ? (
        <section className="sidebar-section">
          <p className="sidebar-label">搜索结果</p>
          {props.searchResults.length > 0 ? (
            <ul className="sidebar-list">
              {props.searchResults.slice(0, 20).map((result, index) => (
                <li key={result.id}>
                  <button
                    className={
                      index === props.activeSearchIndex
                        ? "sidebar-item sidebar-item--active"
                        : "sidebar-item"
                    }
                    onClick={() => props.onOpenSearchResult(result, index)}
                    title={`第 ${result.pageNumber} 页：${result.snippet}`}
                  >
                    <strong>第 {result.pageNumber} 页</strong>
                    <span>{result.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">没有找到与当前关键词匹配的文本。</p>
          )}
        </section>
      ) : null}

      <section className="sidebar-section">
        <p className="sidebar-label">最近打开</p>
        {props.recentDocuments.length > 0 ? (
          <ul className="sidebar-list">
            {props.recentDocuments.map((item) => (
              <li key={item.documentId}>
                <button
                  className="sidebar-item"
                  onClick={() => props.onOpenRecent(item)}
                  title={item.fileName}
                >
                  <strong>{item.fileName}</strong>
                  <span>
                    第 {item.lastPage} 页 · {new Date(item.lastOpenTime).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">暂时还没有最近打开记录。</p>
        )}
      </section>

      <section className="sidebar-section">
        <p className="sidebar-label">目录 / 缩略图</p>
        <p className="muted">这一栏后续会继续接 PDF.js 的目录和页面缩略图。</p>
      </section>
    </aside>
  );
}
