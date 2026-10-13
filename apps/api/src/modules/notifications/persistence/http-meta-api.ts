import { ApiError, ServiceUnavailableError } from "../../../shared/errors.ts";
import { metaCredentialsInvalid, metaPhoneLast4 } from "../domain/meta-verification.ts";
import type { MetaApi, MetaCredentials } from "../ports/meta-api.ts";

export const META_VERIFY_TIMEOUT_MS = 10_000;

/** تحقق Graph v22.0 بحد fetch متحقن؛ أخطاء الشبكة والردود غير المعروفة تعطي 503 فقط. */
export class HttpMetaApi implements MetaApi {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = META_VERIFY_TIMEOUT_MS,
  ) {}

  async verify(credentials: MetaCredentials): Promise<string> {
    const phone = await this.request(
      "GET",
      `${encodeURIComponent(credentials.phoneNumberId)}?fields=display_phone_number,verified_name`,
      credentials.accessToken,
    );
    const last4 = metaPhoneLast4(phone);
    if (last4 === null) throw new ServiceUnavailableError();
    const subscribed = await this.request(
      "POST",
      `${encodeURIComponent(credentials.businessAccountId)}/subscribed_apps`,
      credentials.accessToken,
    );
    if (
      typeof subscribed !== "object" ||
      subscribed === null ||
      (subscribed as { success?: unknown }).success !== true
    )
      throw new ServiceUnavailableError();
    return last4;
  }

  private async request(method: "GET" | "POST", path: string, token: string): Promise<unknown> {
    let response: Response;
    let body: unknown;
    try {
      response = await this.fetchImpl(`https://graph.facebook.com/v22.0/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      try {
        body = await response.json();
      } catch {
        body = null;
      }
    } catch {
      throw new ServiceUnavailableError();
    }
    if (metaCredentialsInvalid(response.status, body))
      throw new ApiError("validation", [
        { path: ["accessToken"], code: "meta_credentials_invalid" },
      ]);
    if (!response.ok || (typeof body === "object" && body !== null && "error" in body))
      throw new ServiceUnavailableError();
    return body;
  }
}
