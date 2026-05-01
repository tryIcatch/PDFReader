import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { safeStorage } from "electron";

type SecurePayload = {
  ai?: {
    apiKey: string;
  };
  mathpix?: {
    appKey: string;
  };
};

type PersistedSecurePayload = {
  encrypted: boolean;
  data: string;
};

export class SecureSettingsService {
  constructor(private readonly filePath: string) {}

  saveAiSecret(apiKey: string): void {
    const store = this.readStore();
    store.ai = { apiKey };
    this.writeStore(store);
  }

  getAiSecret(): string | null {
    return this.readStore().ai?.apiKey ?? null;
  }

  saveMathpixSecret(appKey: string): void {
    const store = this.readStore();
    store.mathpix = { appKey };
    this.writeStore(store);
  }

  getMathpixSecret(): string | null {
    return this.readStore().mathpix?.appKey ?? null;
  }

  private readStore(): SecurePayload {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const persisted = JSON.parse(raw) as PersistedSecurePayload;

      if (persisted.encrypted) {
        if (!safeStorage.isEncryptionAvailable()) {
          return {};
        }

        const decrypted = safeStorage.decryptString(Buffer.from(persisted.data, "base64"));
        return JSON.parse(decrypted) as SecurePayload;
      }

      return JSON.parse(persisted.data) as SecurePayload;
    } catch {
      return {};
    }
  }

  private writeStore(store: SecurePayload): void {
    mkdirSync(dirname(this.filePath), { recursive: true });

    const serialized = JSON.stringify(store);
    const payload: PersistedSecurePayload = safeStorage.isEncryptionAvailable()
      ? {
          encrypted: true,
          data: safeStorage.encryptString(serialized).toString("base64"),
        }
      : {
          encrypted: false,
          data: serialized,
        };

    writeFileSync(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }
}
