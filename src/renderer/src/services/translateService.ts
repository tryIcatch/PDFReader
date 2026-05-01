import type { TranslateTextParams, TranslateTextResult } from "@shared/types";

import { getDesktopApi } from "./desktopApi";

export const translateService = {
  translateText(params: TranslateTextParams): Promise<TranslateTextResult> {
    return getDesktopApi().translateText(params);
  },
};
