import type {
  AiSettingsView,
  AutoTranslateSettingsView,
  FormulaOcrSettingsView,
  MathpixSettingsView,
  Pix2TexSettingsView,
  ProviderHealthCheckResult,
  SaveAiSettingsParams,
  SaveFormulaOcrSettingsParams,
  SaveMathpixSettingsParams,
  SavePix2TexSettingsParams,
  SaveThemeSettingsParams,
  TestMathpixSettingsParams,
  TestPix2TexSettingsParams,
  ThemeSettingsView,
} from "@shared/types";

import { getDesktopApi } from "./desktopApi";

export const settingsService = {
  saveAiSettings(params: SaveAiSettingsParams): Promise<void> {
    return getDesktopApi().saveAiSettings(params);
  },

  getAiSettings(): Promise<AiSettingsView | null> {
    return getDesktopApi().getAiSettings();
  },

  saveMathpixSettings(params: SaveMathpixSettingsParams): Promise<void> {
    return getDesktopApi().saveMathpixSettings(params);
  },

  getMathpixSettings(): Promise<MathpixSettingsView | null> {
    return getDesktopApi().getMathpixSettings();
  },

  testMathpixSettings(params: TestMathpixSettingsParams): Promise<ProviderHealthCheckResult> {
    return getDesktopApi().testMathpixSettings(params);
  },

  savePix2TexSettings(params: SavePix2TexSettingsParams): Promise<void> {
    return getDesktopApi().savePix2TexSettings(params);
  },

  getPix2TexSettings(): Promise<Pix2TexSettingsView | null> {
    return getDesktopApi().getPix2TexSettings();
  },

  testPix2TexSettings(params: TestPix2TexSettingsParams): Promise<ProviderHealthCheckResult> {
    return getDesktopApi().testPix2TexSettings(params);
  },

  saveFormulaOcrSettings(params: SaveFormulaOcrSettingsParams): Promise<void> {
    return getDesktopApi().saveFormulaOcrSettings(params);
  },

  getFormulaOcrSettings(): Promise<FormulaOcrSettingsView | null> {
    return getDesktopApi().getFormulaOcrSettings();
  },

  saveThemeSettings(params: SaveThemeSettingsParams): Promise<void> {
    return getDesktopApi().saveThemeSettings(params);
  },

  getThemeSettings(): Promise<ThemeSettingsView> {
    return getDesktopApi().getThemeSettings();
  },

  saveAutoTranslateSettings(params: { enabled: boolean }): Promise<void> {
    return getDesktopApi().saveAutoTranslateSettings(params);
  },

  getAutoTranslateSettings(): Promise<AutoTranslateSettingsView> {
    return getDesktopApi().getAutoTranslateSettings();
  },
};
