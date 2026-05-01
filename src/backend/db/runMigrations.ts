import type Database from "better-sqlite3";

import { MIGRATIONS } from "./migrations";

type MigrationRow = {
  id: string;
};

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare("SELECT id FROM schema_migrations").all() as MigrationRow[];
  const appliedIds = new Set(appliedRows.map((row) => row.id));
  const insertApplied = db.prepare(`
    INSERT INTO schema_migrations (id, applied_at)
    VALUES (@id, @applied_at)
  `);

  for (const migration of MIGRATIONS) {
    if (appliedIds.has(migration.id)) {
      continue;
    }

    const applyMigration = db.transaction(() => {
      db.exec(migration.sql);
      insertApplied.run({
        id: migration.id,
        applied_at: new Date().toISOString(),
      });
    });

    applyMigration();
  }
}
