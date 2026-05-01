import Database from "better-sqlite3";

export class DatabaseClient {
  readonly connection: Database.Database;

  constructor(dbPath: string) {
    this.connection = new Database(dbPath);
    this.connection.pragma("journal_mode = WAL");
    this.connection.pragma("foreign_keys = ON");
  }

  close(): void {
    if (this.connection.open) {
      this.connection.close();
    }
  }
}
