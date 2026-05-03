import Database from "better-sqlite3";
import { unlinkSync } from "node:fs";

function isShmError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as Record<string, unknown>).code === "SQLITE_IOERR_SHMSIZE"
  );
}

function tryEnableWAL(db: Database.Database, dbPath: string): void {
  try {
    db.pragma("journal_mode = WAL");
  } catch (error) {
    if (isShmError(error)) {
      // Stale WAL/SHM files from a previous crash — clean them up and retry.
      cleanupStaleWALFiles(dbPath);
      try {
        db.pragma("journal_mode = WAL");
        return;
      } catch {
        // Fall through to DELETE mode fallback.
      }
    }
    // WAL failed for an unknown reason — fall back to DELETE journal mode,
    // which doesn't require shared memory.
    console.warn(
      "[db] WAL mode unavailable, falling back to DELETE journal mode:",
      error instanceof Error ? error.message : error,
    );
    db.pragma("journal_mode = DELETE");
  }
}

function cleanupStaleWALFiles(dbPath: string): void {
  for (const suffix of ["-wal", "-shm"]) {
    try {
      unlinkSync(dbPath + suffix);
    } catch {
      // File may not exist — that's fine.
    }
  }
}

export class DatabaseClient {
  readonly connection: Database.Database;

  constructor(dbPath: string) {
    this.connection = new Database(dbPath);
    tryEnableWAL(this.connection, dbPath);
    this.connection.pragma("foreign_keys = ON");
  }

  close(): void {
    if (this.connection.open) {
      this.connection.close();
    }
  }
}
