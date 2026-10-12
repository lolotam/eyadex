import { ServiceUnavailableError } from "../../../shared/errors.ts";
import { last4FromOwnerJid, qrDataUrlOf } from "../domain/whatsapp-rules.ts";
import type {
  EvolutionApi,
  EvolutionConnectionState,
  EvolutionConnectResult,
  EvolutionIntegration,
} from "../ports/evolution-api.ts";

// Every call gives up after 5 s: the API answers 503 instead of holding the request.
const TIMEOUT_MS = 5_000;

type Body = Record<string, unknown> | unknown[] | null;

interface Answer {
  readonly status: number;
  readonly body: Body;
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// Unreachable, a timeout, a 5xx, a refused key or an answer this adapter does not understand: one
// 503 for the client. Nothing of Evolution's reply or of the request is kept, chained or logged — the
// reply can carry the QR or the number, the request carries the API key.
const unavailable = (): ServiceUnavailableError => new ServiceUnavailableError();

/**
 * Evolution API v2 over HTTP (spec §7.1, N-7): the dedicated container on the internal network, the
 * global key in the `apikey` header. Implements the module's port; only `notifications.module.ts` binds it.
 */
export class HttpEvolutionApi implements EvolutionApi {
  readonly configured = true;

  constructor(
    private readonly config: { readonly baseUrl: URL; readonly apiKey: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createInstance(
    instanceName: string,
    integration: EvolutionIntegration,
  ): Promise<"created" | "exists"> {
    // No `qrcode: true`: Evolution then waits 5 s before answering, past this adapter's timeout. The QR
    // comes from `instance/connect` right after.
    const body =
      integration.kind === "baileys"
        ? { instanceName, integration: "WHATSAPP-BAILEYS", qrcode: false }
        : {
            instanceName,
            integration: "WHATSAPP-BUSINESS",
            token: integration.accessToken,
            number: integration.phoneNumberId,
            businessId: integration.businessAccountId,
          };
    const answer = await this.request("POST", "/instance/create", body);
    if (answer.status === 201 || answer.status === 200) return "created";
    // Evolution refuses a name already in use with 403 (instanceLoggedGuard).
    if (answer.status === 403) return "exists";
    throw unavailable();
  }

  async connect(instanceName: string): Promise<EvolutionConnectResult> {
    const answer = await this.request(
      "GET",
      `/instance/connect/${encodeURIComponent(instanceName)}`,
    );
    if (answer.status === 404) return { state: "missing" };
    if (answer.status !== 200) throw unavailable();
    const body = record(answer.body);
    // An internal failure is a 200 with `{ error: true }` (InstanceController.connectToWhatsapp).
    if (body["error"] === true) throw unavailable();
    // Already linked: the connection state's shape.
    if (record(body["instance"])["state"] === "open") return { state: "open" };
    // `connecting` / `close`: the QR object itself, or `{ instance, qrcode }` for any other state.
    const qr = "base64" in body || "code" in body ? body : record(body["qrcode"]);
    return { state: "pending", qrDataUrl: qrDataUrlOf(qr["base64"]) };
  }

  async connectionState(instanceName: string): Promise<EvolutionConnectionState> {
    const answer = await this.request(
      "GET",
      `/instance/connectionState/${encodeURIComponent(instanceName)}`,
    );
    if (answer.status === 404) return "missing";
    if (answer.status !== 200) throw unavailable();
    const state = record(record(answer.body)["instance"])["state"];
    return state === "open" || state === "connecting" ? state : "close";
  }

  async ownerLast4(instanceName: string): Promise<string | null> {
    const answer = await this.request(
      "GET",
      `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
    );
    if (answer.status === 404) return null;
    if (answer.status !== 200 || !Array.isArray(answer.body)) throw unavailable();
    return last4FromOwnerJid(record(answer.body[0])["ownerJid"]);
  }

  async logout(instanceName: string): Promise<void> {
    const answer = await this.request(
      "DELETE",
      `/instance/logout/${encodeURIComponent(instanceName)}`,
    );
    // 400: the instance is not connected; 404: there is none. Either way it is logged out.
    if (answer.status === 200 || answer.status === 400 || answer.status === 404) return;
    throw unavailable();
  }

  async deleteInstance(instanceName: string): Promise<void> {
    const answer = await this.request(
      "DELETE",
      `/instance/delete/${encodeURIComponent(instanceName)}`,
    );
    if (answer.status === 200 || answer.status === 404) return;
    throw unavailable();
  }

  private async request(method: "GET" | "POST" | "DELETE", path: string, body?: object) {
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, this.config.baseUrl), {
        method,
        headers: {
          apikey: this.config.apiKey,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw unavailable();
    }
    if (response.status >= 500 || response.status === 401) throw unavailable();
    let parsed: Body = null;
    try {
      parsed = (await response.json()) as Body;
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed } satisfies Answer;
  }
}

/**
 * The port when `EVOLUTION_API_URL` and `EVOLUTION_API_KEY` are both unset: the API still starts, a link
 * request answers 503, and an unlink only clears the clinic's row.
 */
export class UnconfiguredEvolutionApi implements EvolutionApi {
  readonly configured = false;

  createInstance(): Promise<"created" | "exists"> {
    return Promise.reject(unavailable());
  }

  connect(): Promise<EvolutionConnectResult> {
    return Promise.reject(unavailable());
  }

  connectionState(): Promise<EvolutionConnectionState> {
    return Promise.reject(unavailable());
  }

  ownerLast4(): Promise<string | null> {
    return Promise.reject(unavailable());
  }

  logout(): Promise<void> {
    return Promise.reject(unavailable());
  }

  deleteInstance(): Promise<void> {
    return Promise.reject(unavailable());
  }
}
