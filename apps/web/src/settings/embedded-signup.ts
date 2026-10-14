import type {
  WhatsappEmbeddedSignupRequest,
  WhatsappSignupConfig,
} from "@eyadex/contracts/whatsapp";

/** What Meta's `WA_EMBEDDED_SIGNUP` message told us: the ids, or that the admin stopped. */
export type SignupMessage =
  { kind: "ids"; wabaId: string | null; phoneNumberId: string | null } | { kind: "cancel" };

export type SignupOutcome =
  | { kind: "ready"; request: WhatsappEmbeddedSignupRequest }
  | { kind: "cancelled" }
  | { kind: "closed" }
  | { kind: "missing_ids" };

type FbLoginResponse = { authResponse?: { code?: string | null } | null };
export type FbLike = {
  init(options: Record<string, unknown>): void;
  login(callback: (response: FbLoginResponse) => void, options: Record<string, unknown>): void;
};
type MessageTarget = {
  addEventListener(type: "message", fn: (e: MessageEvent) => void): void;
  removeEventListener(type: "message", fn: (e: MessageEvent) => void): void;
};

export const SIGNUP_IDS_WAIT_MS = 2500;
const SDK_URL = "https://connect.facebook.net/en_US/sdk.js";

const fromFacebook = (origin: string) => {
  try {
    const host = new URL(origin).hostname;
    return host === "facebook.com" || host.endsWith(".facebook.com");
  } catch {
    return false;
  }
};

const text = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

/** Reads one `message` event; anything not from Facebook or not the signup message is ignored. */
export function readSignupMessage(origin: string, data: unknown): SignupMessage | null {
  if (!fromFacebook(origin)) return null;
  let value: unknown = data;
  if (typeof data === "string") {
    try {
      value = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (value === null || typeof value !== "object") return null;
  const msg = value as Record<string, unknown>;
  if (msg["type"] !== "WA_EMBEDDED_SIGNUP") return null;
  if (msg["event"] === "CANCEL" || msg["event"] === "ERROR") return { kind: "cancel" };
  const nested =
    msg["data"] && typeof msg["data"] === "object" ? (msg["data"] as Record<string, unknown>) : {};
  return {
    kind: "ids",
    wabaId: text(nested["waba_id"]) ?? text(msg["waba_id"]),
    phoneNumberId: text(nested["phone_number_id"]) ?? text(msg["phone_number_id"]),
  };
}

/** Opens Meta's window; the FB callback stays synchronous and the waiting runs beside it. */
export function runEmbeddedSignup(
  fb: FbLike,
  config: WhatsappSignupConfig,
  target: MessageTarget,
  onDone: (outcome: SignupOutcome) => void,
  waitMs = SIGNUP_IDS_WAIT_MS,
): () => void {
  let wabaId: string | null = null;
  let phoneNumberId: string | null = null;
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => {
    done = true;
    clearTimeout(timer);
    target.removeEventListener("message", listener);
  };
  const finish = (outcome: SignupOutcome) => {
    if (done) return;
    dispose();
    onDone(outcome);
  };
  const listener = (e: MessageEvent) => {
    const msg = readSignupMessage(e.origin, e.data);
    if (!msg) return;
    if (msg.kind === "cancel") return finish({ kind: "cancelled" });
    wabaId = msg.wabaId ?? wabaId;
    phoneNumberId = msg.phoneNumberId ?? phoneNumberId;
  };
  target.addEventListener("message", listener);
  const waitForIds = (code: string) => {
    const deadline = Date.now() + waitMs;
    const tick = () => {
      if (done) return;
      if (wabaId && phoneNumberId)
        return finish({ kind: "ready", request: { code, wabaId, phoneNumberId } });
      if (Date.now() >= deadline) return finish({ kind: "missing_ids" });
      timer = setTimeout(tick, 100);
    };
    tick();
  };
  try {
    fb.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) finish({ kind: "closed" });
        else waitForIds(code);
      },
      {
        config_id: config.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          feature: "whatsapp_embedded_signup",
          sessionInfoVersion: "3",
          featureType: "whatsapp_business_app_onboarding",
          setup: {},
        },
      },
    );
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}

let sdk: Promise<FbLike> | null = null;

/** Loads Meta's SDK once per page, only when the WhatsApp tab asks for it. */
export function loadFacebookSdk(config: WhatsappSignupConfig): Promise<FbLike> {
  sdk ??= new Promise<FbLike>((resolve, reject) => {
    const w = window as unknown as { FB?: FbLike; fbAsyncInit?: () => void };
    const ready = () => {
      w.FB!.init({
        appId: config.appId,
        version: config.graphVersion,
        xfbml: false,
        cookie: false,
      });
      resolve(w.FB!);
    };
    if (w.FB) return ready();
    w.fbAsyncInit = ready;
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      sdk = null;
      reject(new Error("sdk"));
    };
    document.body.appendChild(script);
  });
  return sdk;
}
