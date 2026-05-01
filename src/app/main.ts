import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DatabaseClient } from "../backend/db/DatabaseClient";
import { runMigrations } from "../backend/db/runMigrations";
import { IPC_CHANNELS } from "../shared/ipc/channels";
import type { AppMenuAction } from "../shared/types";
import { registerIpcHandlers } from "./ipc/registerIpcHandlers";

let mainWindow: BrowserWindow | null = null;
let databaseClient: DatabaseClient | null = null;
const currentDir = dirname(fileURLToPath(import.meta.url));

function sendAppMenuAction(window: BrowserWindow, action: AppMenuAction) {
  window.webContents.send(IPC_CHANNELS.APP_MENU_ACTION, action);
}

function buildApplicationMenu(window: BrowserWindow): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "打开文件",
          accelerator: "CmdOrCtrl+O",
          click: () => sendAppMenuAction(window, "open_file"),
        },
        {
          label: "论文仓库",
          accelerator: "CmdOrCtrl+L",
          click: () => sendAppMenuAction(window, "open_library"),
        },
      ],
    },
    {
      label: "设置",
      submenu: [
        {
          label: "打开设置",
          accelerator: "CmdOrCtrl+,",
          click: () => sendAppMenuAction(window, "open_settings"),
        },
      ],
    },
    {
      label: "视图",
      submenu: [
        {
          label: "搜索",
          accelerator: "CmdOrCtrl+F",
          click: () => sendAppMenuAction(window, "toggle_search"),
        },
        {
          label: "显示/隐藏目录",
          accelerator: "CmdOrCtrl+1",
          click: () => sendAppMenuAction(window, "toggle_sidebar"),
        },
        {
          label: "显示/隐藏 AI 面板",
          accelerator: "CmdOrCtrl+2",
          click: () => sendAppMenuAction(window, "toggle_ai_panel"),
        },
        { type: "separator" },
        {
          label: "恢复 100% 缩放",
          accelerator: "CmdOrCtrl+0",
          click: () => sendAppMenuAction(window, "reset_zoom"),
        },
        { type: "separator" },
        {
          label: "上一页",
          accelerator: "Left",
          click: () => sendAppMenuAction(window, "previous_page"),
        },
        {
          label: "下一页",
          accelerator: "Right",
          click: () => sendAppMenuAction(window, "next_page"),
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    show: true,
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "PDF 智能阅读器",
    backgroundColor: "#f5f0e8",
    webPreferences: {
      preload: join(currentDir, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[main] did-fail-load", {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[main] render-process-gone", details);
  });

  window.webContents.setZoomFactor(1);
  void window.webContents.setVisualZoomLevelLimits(1, 1).catch((error) => {
    console.error("[main] setVisualZoomLevelLimits failed", error);
  });
  window.webContents.on("zoom-changed", (event) => {
    event.preventDefault();
    window.webContents.setZoomFactor(1);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    const indexPath = join(currentDir, "../renderer/index.html");
    void window.loadFile(indexPath);
  }

  window.setMenu(buildApplicationMenu(window));
  return window;
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  const dbPath = join(app.getPath("userData"), "pdf-reader-v1.sqlite");
  databaseClient = new DatabaseClient(dbPath);
  runMigrations(databaseClient.connection);

  registerIpcHandlers({
    db: databaseClient.connection,
    userDataPath: app.getPath("userData"),
    documentsPath: app.getPath("documents"),
  });

  mainWindow = createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  databaseClient?.close();
});

void bootstrap().catch((error) => {
  console.error("[main] bootstrap failed", error);
  app.exit(1);
});
