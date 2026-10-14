import { randomBytes } from "node:crypto";

import type { MetaApi, MetaApp, MetaCredentials } from "../ports/meta-api.ts";

/** حد Meta فقط؛ لا تستبدل أي طبقة داخلية في اختبارات قاعدة البيانات. */
export class FakeMeta implements MetaApi {
  readonly calls: MetaCredentials[] = [];
  readonly exchanges: { code: string; app: MetaApp }[] = [];
  error: Error | null = null;
  exchangeError: Error | null = null;
  /** The token the next code exchange mints: a shaped placeholder, never a real Meta token. */
  token = randomBytes(24).toString("hex");

  verify(credentials: MetaCredentials): Promise<string> {
    this.calls.push(credentials);
    return this.error === null ? Promise.resolve("0001") : Promise.reject(this.error);
  }

  exchangeCode(code: string, app: MetaApp): Promise<string> {
    this.exchanges.push({ code, app });
    return this.exchangeError === null
      ? Promise.resolve(this.token)
      : Promise.reject(this.exchangeError);
  }
}
