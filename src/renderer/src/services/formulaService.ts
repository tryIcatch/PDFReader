import type {
  ExplainFormulaParams,
  ExplainFormulaResult,
  FormulaItem,
  RecognizeFormulaParams,
  RecognizeFormulaResult,
  SaveFormulaImageParams,
  SaveFormulaImageResult,
} from "@shared/types";

import { getDesktopApi } from "./desktopApi";

export const formulaService = {
  recognizeFormula(params: RecognizeFormulaParams): Promise<RecognizeFormulaResult> {
    return getDesktopApi().recognizeFormula(params);
  },

  explainFormula(params: ExplainFormulaParams): Promise<ExplainFormulaResult> {
    return getDesktopApi().explainFormula(params);
  },

  listByDocument(documentId: string): Promise<FormulaItem[]> {
    return getDesktopApi().listFormulasByDocument(documentId);
  },

  getById(formulaId: string): Promise<FormulaItem | null> {
    return getDesktopApi().getFormulaById(formulaId);
  },

  saveFormulaImage(params: SaveFormulaImageParams): Promise<SaveFormulaImageResult> {
    return getDesktopApi().saveFormulaImage(params);
  },
};
