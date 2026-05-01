import type Database from "better-sqlite3";

import { parseJson } from "../../utils/json";

type SettingRow = {
  key: string;
  value_json: string;
  updated_at: string;
};

export class SettingsRepository {
  constructor(private readonly db: Database.Database) {}

  upsert<T>(key: string, value: T): void {
    this.db
      .prepare(`
        INSERT INTO settings (key, value_json, updated_at)
        VALUES (@key, @value_json, @updated_at)
        ON CONFLICT(key)
        DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `)
      .run({
        key,
        value_json: JSON.stringify(value),
        updated_at: new Date().toISOString(),
      });
  }

  get<T>(key: string): T | null {
    const row = this.db.prepare("SELECT * FROM settings WHERE key = ?").get(key) as
      | SettingRow
      | undefined;

    if (!row) {
      return null;
    }

    return parseJson<T>(row.value_json) ?? null;
  }
}
