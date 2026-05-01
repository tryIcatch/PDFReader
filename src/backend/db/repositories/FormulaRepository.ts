import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type { FormulaItem, FormulaOcrProvider, FormulaVariable, NormalizedRect } from "@shared/types";

import { parseJson, stringifyJson } from "../../utils/json";

type FormulaRow = {
  id: string;
  document_id: string;
  page_number: number;
  bbox_json: string;
  image_path: string;
  latex: string | null;
  explanation: string | null;
  variables_json: string | null;
  confidence: number | null;
  ocr_provider: FormulaOcrProvider;
  source_context: string | null;
  created_at: string;
  updated_at: string;
};

export class FormulaRepository {
  constructor(private readonly db: Database.Database) {}

  create(params: {
    documentId: string;
    pageNumber: number;
    bbox: NormalizedRect;
    imagePath: string;
    latex: string;
    confidence?: number;
    ocrProvider: FormulaOcrProvider;
    sourceContext?: string;
  }): FormulaItem {
    const now = new Date().toISOString();
    const formula: FormulaItem = {
      id: randomUUID(),
      documentId: params.documentId,
      pageNumber: params.pageNumber,
      bbox: params.bbox,
      imagePath: params.imagePath,
      latex: params.latex,
      confidence: params.confidence,
      ocrProvider: params.ocrProvider,
      sourceContext: params.sourceContext,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(`
        INSERT INTO formulas (
          id,
          document_id,
          page_number,
          bbox_json,
          image_path,
          latex,
          confidence,
          ocr_provider,
          source_context,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          @document_id,
          @page_number,
          @bbox_json,
          @image_path,
          @latex,
          @confidence,
          @ocr_provider,
          @source_context,
          @created_at,
          @updated_at
        )
      `)
      .run({
        id: formula.id,
        document_id: formula.documentId,
        page_number: formula.pageNumber,
        bbox_json: stringifyJson(formula.bbox),
        image_path: formula.imagePath,
        latex: formula.latex ?? null,
        confidence: formula.confidence ?? null,
        ocr_provider: formula.ocrProvider,
        source_context: formula.sourceContext ?? null,
        created_at: formula.createdAt,
        updated_at: formula.updatedAt,
      });

    return formula;
  }

  updateExplanation(formulaId: string, explanation: string, variables: FormulaVariable[]): void {
    this.db
      .prepare(`
        UPDATE formulas
        SET explanation = @explanation,
            variables_json = @variables_json,
            updated_at = @updated_at
        WHERE id = @id
      `)
      .run({
        id: formulaId,
        explanation,
        variables_json: stringifyJson(variables),
        updated_at: new Date().toISOString(),
      });
  }

  listByDocument(documentId: string): FormulaItem[] {
    const rows = this.db
      .prepare(`
        SELECT *
        FROM formulas
        WHERE document_id = ?
        ORDER BY page_number ASC, created_at DESC
      `)
      .all(documentId) as FormulaRow[];

    return rows.map((row) => this.mapRow(row));
  }

  getById(formulaId: string): FormulaItem | null {
    const row = this.db.prepare("SELECT * FROM formulas WHERE id = ?").get(formulaId) as
      | FormulaRow
      | undefined;

    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: FormulaRow): FormulaItem {
    return {
      id: row.id,
      documentId: row.document_id,
      pageNumber: row.page_number,
      bbox: parseJson<NormalizedRect>(row.bbox_json) ?? {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        coordSpace: "page_normalized",
        origin: "top_left",
      },
      imagePath: row.image_path,
      latex: row.latex ?? undefined,
      explanation: row.explanation ?? undefined,
      variables: parseJson<FormulaVariable[]>(row.variables_json),
      confidence: row.confidence ?? undefined,
      ocrProvider: row.ocr_provider,
      sourceContext: row.source_context ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
