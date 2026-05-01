import type { HistoryItem, ListHistoryParams } from "@shared/types";

import { getDesktopApi } from "./desktopApi";

export const historyService = {
  list(params?: ListHistoryParams): Promise<HistoryItem[]> {
    return getDesktopApi().listHistory(params);
  },
};
