import { ApiError, ServiceUnavailableError } from "../../../shared/errors.ts";
import {
  metaAccessToken,
  metaCredentialsInvalid,
  metaPhoneLast4,
  metaTwoStepEnabled,
} from "../domain/meta-verification.ts";
import {
  META_GRAPH_VERSION,
  type MetaApi,
  type MetaApp,
  type MetaCredentials,
} from "../ports/meta-api.ts";

export const META_VERIFY_TIMEOUT_MS = 10_000;

const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}/`;

const refused = (path: string, code: string) =>
  new ApiError("validation", [{ path: [path], code }]);

/** An answer Meta gave: its status and its body, or `null` when the body was not JSON. */
interface Answer {
  readonly status: number;
  readonly ok: boolean;
  readonly body: unknown;
}

/** تحقق Graph v22.0 بحد fetch متحقن؛ أخطاء الشبكة والردود غير المعروفة تعطي 503 فقط. */
export class HttpMetaApi implements MetaApi {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = META_VERIFY_TIMEOUT_MS,
  ) {}

  async verify(credentials: MetaCredentials): Promise<string> {
    const phone = await this.call(
      "GET",
      `${encodeURIComponent(credentials.phoneNumberId)}?fields=display_phone_number,verified_name`,
      credentials.accessToken,
    );
    const last4 = metaPhoneLast4(phone);
    if (last4 === null) throw new ServiceUnavailableError();
    const subscribed = await this.call(
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

  // No redirect_uri: the code comes from the JavaScript SDK's popup (spec §7.2). The URL carries the app
  // secret, so neither it nor the fetch error (whose cause can quote it) ever leaves this method.
  async exchangeCode(code: string, app: MetaApp): Promise<string> {
    const query = new URLSearchParams({
      client_id: app.appId,
      client_secret: app.appSecret,
      code,
    });
    const answer = await this.fetchJson("GET", `oauth/access_token?${query.toString()}`, null);
    if (answer.status >= 400 && answer.status < 500) throw refused("code", "meta_code_invalid");
    const token = answer.ok ? metaAccessToken(answer.body) : null;
    if (token === null) throw new ServiceUnavailableError();
    return token;
  }

  private async call(method: "GET" | "POST", path: string, token: string): Promise<unknown> {
    const { status, ok, body } = await this.fetchJson(method, path, token);
    // 2388001 comes with a 400: it must win over the generic refusal of the credentials.
    if (metaTwoStepEnabled(body)) throw refused("phoneNumberId", "meta_two_step_enabled");
    if (metaCredentialsInvalid(status, body))
      throw refused("accessToken", "meta_credentials_invalid");
    if (!ok || (typeof body === "object" && body !== null && "error" in body))
      throw new ServiceUnavailableError();
    return body;
  }

  private async fetchJson(
    method: "GET" | "POST",
    path: string,
    token: string | null,
  ): Promise<Answer> {
    try {
      const response = await this.fetchImpl(`${GRAPH}${path}`, {
        method,
        headers: token === null ? {} : { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { status: response.status, ok: response.ok, body };
    } catch {
      throw new ServiceUnavailableError();
    }
  }
}
