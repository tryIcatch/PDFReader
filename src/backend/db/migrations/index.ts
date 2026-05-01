import initSql from "./001_init.sql?raw";
import formulaProviderPix2texSql from "./002_formula_ocr_provider_pix2tex.sql?raw";
import libraryRepositorySql from "./003_library_repository.sql?raw";

export type SqlMigration = {
  id: string;
  sql: string;
};

export const MIGRATIONS: SqlMigration[] = [
  {
    id: "001_init",
    sql: initSql,
  },
  {
    id: "002_formula_ocr_provider_pix2tex",
    sql: formulaProviderPix2texSql,
  },
  {
    id: "003_library_repository",
    sql: libraryRepositorySql,
  },
];
