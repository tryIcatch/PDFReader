import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

type TranslationCacheRow = {
  id: string;
  cache_key: string;
  source_text: string;
  target_lang: string;
  translated_text: string;
  model_name: string;
  created_at: string;
};

export type TranslationCacheRecord = {
  id: string;
  cacheKey: string;
  sourceText: string;
  targetLang: string;
  translatedText: string;
  modelName: string;
  createdAt: string;
};

export class TranslationCacheRepository {
  constructor(private readonly db: Database.Database) {}

  getByCacheKey(cacheKey: string): TranslationCacheRecord | null {
    const row = this.db
      .prepare("SELECT * FROM translation_cache WHERE cache_key = ?")
      .get(cacheKey) as TranslationCacheRow | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      cacheKey: row.cache_key,
      sourceText: row.source_text,
      targetLang: row.target_lang,
      translatedText: row.translated_text,
      modelName: row.model_name,
      createdAt: row.created_at,
    };
  }

  save(params: {
    cacheKey: string;
    sourceText: string;
    targetLang: string;
    translatedText: string;
    modelName: string;
  }): void {
    const now = new Date().toISOString();

    this.db
      .prepare(`
        INSERT OR REPLACE INTO translation_cache (
          id,
          cache_key,
          source_text,
          target_lang,
          translated_text,
          model_name,
          created_at
        )
        VALUES (
          @id,
          @cache_key,
          @source_text,
          @target_lang,
          @translated_text,
          @model_name,
          @created_at
        )
      `)
      .run({
        id: randomUUID(),
        cache_key: params.cacheKey,
        source_text: params.sourceText,
        target_lang: params.targetLang,
        translated_text: params.translatedText,
        model_name: params.modelName,
        created_at: now,
      });
  }
}
