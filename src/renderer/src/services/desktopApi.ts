import type { PreloadApi } from "@shared/types";

export function getDesktopApi(): PreloadApi {
  if (!window.pdfReader) {
    throw new Error(
      "桌面桥接未注入：当前页面没有拿到 Electron preload API。请优先在 Electron 窗口中使用；如果你已经在桌面窗口里，请完全重启 `npm run dev`。",
    );
  }

  return window.pdfReader;
}
