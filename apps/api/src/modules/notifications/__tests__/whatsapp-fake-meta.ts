import type { MetaApi, MetaCredentials } from "../ports/meta-api.ts";

/** حد Meta فقط؛ لا تستبدل أي طبقة داخلية في اختبارات قاعدة البيانات. */
export class FakeMeta implements MetaApi {
  readonly calls: MetaCredentials[] = [];
  error: Error | null = null;
  verify(credentials: MetaCredentials): Promise<string> {
    this.calls.push(credentials);
    return this.error === null ? Promise.resolve("0001") : Promise.reject(this.error);
  }
}
