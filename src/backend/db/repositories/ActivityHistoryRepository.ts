import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type { HistoryActionType, HistoryItem, ListHistoryParams } from "@shared/types";

import { parseJson, stringifyJson } from "../../utils/json";

type HistoryRow = {
  id: string;
  document_id: string | null;
  action_type: HistoryActionType;
  payload_json: string | null;
  created_at: string;
};

export class ActivityHistoryRepository {
  constructor(private readonly db: Database.Database) {}

  log(params: {
    documentId?: string;
    actionType: HistoryActionType;
    payload?: Record<string, unknown>;
  }): void {
    this.db
      .prepare(`
        INSERT INTO activity_history (
          id,
          document_id,
          action_type,
          payload_json,
          created_at
        )
        VALUES (
          @id,
          @document_id,
          @action_type,
          @payload_json,
          @created_at
        )
      `)
      .run({
        id: randomUUID(),
        document_id: params.documentId ?? null,
        action_type: params.actionType,
        payload_json: stringifyJson(params.payload),
        created_at: new Date().toISOString(),
      });
  }

  list(params?: ListHistoryParams): HistoryItem[] {
    const conditions: string[] = [];
    const values: Array<string | number> = [];

    if (params?.documentId) {
      conditions.push("document_id = ?");
      values.push(params.documentId);
    }

    if (params?.actionType) {
      conditions.push("action_type = ?");
      values.push(params.actionType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = params?.limit ?? 50;

    const rows = this.db
      .prepare(`
        SELECT *
        FROM activity_history
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(...values, limit) as HistoryRow[];

    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_id ?? undefined,
      actionType: row.action_type,
      payload: parseJson<Record<string, unknown>>(row.payload_json) ?? null,
      createdAt: row.created_at,
    }));
  }
}
