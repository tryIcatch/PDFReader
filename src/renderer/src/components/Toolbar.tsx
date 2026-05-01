import { useEffect, useRef, useState } from "react";

type ToolbarProps = {
  isSidebarOpen: boolean;
  isAiPanelOpen: boolean;
  isSearchOpen: boolean;
  onOpenFile: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  onToggleAiPanel: () => void;
  onOpenSearch: () => void;
};

export function Toolbar(props: ToolbarProps) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!fileMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;

      if (target instanceof Node && fileMenuRef.current?.contains(target)) {
        return;
      }

      setFileMenuOpen(false);
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [fileMenuOpen]);

  return (
    <header className="reader-controls">
      <div className="reader-controls-group">
        <div className="reader-file-menu" ref={fileMenuRef}>
          <button
            className={fileMenuOpen ? "secondary reader-control reader-control--active" : "secondary reader-control"}
            onClick={() => setFileMenuOpen((open) => !open)}
          >
            File
          </button>
          {fileMenuOpen ? (
            <div className="reader-dropdown">
              <button
                className="secondary reader-dropdown-item"
                onClick={() => {
                  setFileMenuOpen(false);
                  props.onOpenFile();
                }}
              >
                打开文件
              </button>
            </div>
          ) : null}
        </div>

        <button className="secondary reader-control" onClick={props.onOpenSettings}>
          设置
        </button>

        <button
          className={
            props.isSidebarOpen
              ? "secondary reader-control reader-control--active"
              : "secondary reader-control"
          }
          onClick={props.onToggleSidebar}
        >
          目录
        </button>

        <button
          className={
            props.isAiPanelOpen
              ? "secondary reader-control reader-control--active"
              : "secondary reader-control"
          }
          onClick={props.onToggleAiPanel}
        >
          AI
        </button>
      </div>

      <div className="reader-controls-group reader-controls-group--right">
        <button
          className={
            props.isSearchOpen
              ? "secondary reader-control reader-control--active"
              : "secondary reader-control"
          }
          onClick={props.onOpenSearch}
          title="搜索（Ctrl+F）"
        >
          搜索
        </button>
      </div>
    </header>
  );
}
