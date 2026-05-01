import type { ExportMarkdownParams, ExportMarkdownResult } from "@shared/types";

import { getDesktopApi } from "./desktopApi";

export const exportService = {
  exportMarkdown(params: ExportMarkdownParams): Promise<ExportMarkdownResult> {
    return getDesktopApi().exportMarkdown(params);
  },
};
