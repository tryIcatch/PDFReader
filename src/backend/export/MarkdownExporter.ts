import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { dialog, type BrowserWindow } from "electron";

import type { ExportMarkdownParams, ExportMarkdownResult, FormulaItem, NoteItem } from "@shared/types";

import type { DocumentRecord } from "../db/repositories/DocumentRepository";

export class MarkdownExporter {
  async export(params: {
    document: DocumentRecord;
    notes: NoteItem[];
    formulas: FormulaItem[];
    options: ExportMarkdownParams;
    defaultDirectory: string;
    ownerWindow?: BrowserWindow | null;
  }): Promise<ExportMarkdownResult> {
    const outputPath =
      params.options.outputPath ||
      (await this.pickOutputPath(
        params.document.fileName,
        params.defaultDirectory,
        params.ownerWindow ?? null,
      ));

    const markdown = this.buildMarkdown(params.document, params.notes, params.formulas, params.options);
    await writeFile(outputPath, markdown, "utf8");

    const uniqueFormulaIds = new Set(
      params.notes.filter((note) => note.noteType === "formula_favorite").map((note) => note.formulaId),
    );

    return {
      outputPath,
      noteCount: params.notes.length,
      formulaCount: [...uniqueFormulaIds].filter(Boolean).length,
    };
  }

  private async pickOutputPath(
    fileName: string,
    defaultDirectory: string,
    ownerWindow: BrowserWindow | null,
  ): Promise<string> {
    const suggestedName = `${basename(fileName, ".pdf")}-notes.md`;
    const dialogOptions = {
      title: "导出 Markdown",
      defaultPath: join(defaultDirectory, suggestedName),
      filters: [{ name: "Markdown", extensions: ["md"] }],
    };
    const result = ownerWindow
      ? await dialog.showSaveDialog(ownerWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);

    if (result.canceled || !result.filePath) {
      throw new Error("Export canceled");
    }

    return result.filePath;
  }

  private buildMarkdown(
    document: DocumentRecord,
    notes: NoteItem[],
    formulas: FormulaItem[],
    options: ExportMarkdownParams,
  ): string {
    const formulaMap = new Map(formulas.map((formula) => [formula.id, formula]));
    const lines: string[] = [
      `# ${document.fileName}`,
      "",
      `- Source: ${document.filePath}`,
      `- Exported At: ${new Date().toISOString()}`,
      "",
    ];

    if (notes.length === 0) {
      lines.push("暂无笔记内容。", "");
      return lines.join("\n");
    }

    const pages = new Map<number, NoteItem[]>();

    for (const note of notes) {
      const items = pages.get(note.pageNumber) ?? [];
      items.push(note);
      pages.set(note.pageNumber, items);
    }

    for (const pageNumber of [...pages.keys()].sort((a, b) => a - b)) {
      lines.push(`## 第 ${pageNumber} 页`, "");

      for (const note of pages.get(pageNumber) ?? []) {
        if (note.noteType === "highlight") {
          lines.push("### 文本高亮");
        } else if (note.noteType === "comment") {
          lines.push("### 文本批注");
        } else {
          lines.push("### 公式收藏");
        }

        if (options.includeOriginal && note.selectedText) {
          lines.push(`- 原文：${note.selectedText}`);
        }

        if (options.includeTranslation && note.translatedText) {
          lines.push(`- 译文：${note.translatedText}`);
        }

        if (note.comment) {
          lines.push(`- 批注：${note.comment}`);
        }

        if (note.noteType === "formula_favorite" && note.formulaId) {
          const formula = formulaMap.get(note.formulaId);

          if (options.includeLatex && formula?.latex) {
            lines.push(`- LaTeX：\`${formula.latex}\``);
          }

          if (options.includeExplanation && formula?.explanation) {
            lines.push(`- 解释：${formula.explanation}`);
          }
        }

        lines.push("");
      }
    }

    return lines.join("\n");
  }
}
