import type { PreloadApi } from "./types";

declare global {
  interface Window {
    pdfReader: PreloadApi;
  }
}

export {};
