import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SIGNUP_IDS_WAIT_MS,
  readSignupMessage,
  runEmbeddedSignup,
  type FbLike,
  type SignupOutcome,
} from "./embedded-signup";

const FB_ORIGIN = "https://www.facebook.com";
const config = { appId: "100000000000001", configId: "200000000000002", graphVersion: "v21.0" };
const finish = (data: object) => ({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH", ...data });

function harness(code: string | null) {
  let listener: ((e: MessageEvent) => void) | null = null;
  const target = {
    addEventListener: (_: "message", fn: (e: MessageEvent) => void) => (listener = fn),
    removeEventListener: () => (listener = null),
  };
  let callback: ((r: { authResponse?: { code?: string | null } | null }) => void) | null = null;
  let loginOptions: Record<string, unknown> = {};
  const fb: FbLike = {
    init: () => {},
    login: (cb, options) => {
      callback = cb;
      loginOptions = options;
    },
  };
  const outcomes: SignupOutcome[] = [];
  const dispose = runEmbeddedSignup(fb, config, target, (o) => outcomes.push(o));
  return {
    dispose,
    outcomes,
    loginOptions: () => loginOptions,
    post: (origin: string, data: unknown) => listener?.({ origin, data } as MessageEvent),
    answer: () => callback!({ authResponse: code ? { code } : null }),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("reading Meta's message", () => {
  it("ignores a foreign origin, even one that only looks like Facebook", () => {
    const msg = JSON.stringify(finish({ data: { waba_id: "1", phone_number_id: "2" } }));
    expect(readSignupMessage("https://evil.example", msg)).toBeNull();
    expect(readSignupMessage("https://evilfacebook.com", msg)).toBeNull();
    expect(readSignupMessage(FB_ORIGIN, msg)).not.toBeNull();
  });

  it("collects nested ids from a string or an object", () => {
    const ids = { kind: "ids", wabaId: "300000000000003", phoneNumberId: "400000000000004" };
    const data = { data: { waba_id: ids.wabaId, phone_number_id: ids.phoneNumberId } };
    expect(readSignupMessage(FB_ORIGIN, JSON.stringify(finish(data)))).toEqual(ids);
    expect(readSignupMessage(FB_ORIGIN, finish(data))).toEqual(ids);
    expect(
      readSignupMessage(
        FB_ORIGIN,
        finish({ waba_id: ids.wabaId, phone_number_id: ids.phoneNumberId }),
      ),
    ).toEqual(ids);
  });

  it("keeps only WA_EMBEDDED_SIGNUP", () => {
    expect(readSignupMessage(FB_ORIGIN, { type: "OTHER" })).toBeNull();
    expect(readSignupMessage(FB_ORIGIN, "not json")).toBeNull();
  });
});

describe("the signup flow", () => {
  it("opens FB.login with the brief's options", () => {
    const h = harness("c");
    expect(h.loginOptions()).toMatchObject({
      config_id: config.configId,
      response_type: "code",
      override_default_response_type: true,
      extras: { feature: "whatsapp_embedded_signup", sessionInfoVersion: "3" },
    });
  });

  it("a code plus the ids is ready to post", () => {
    const h = harness("one-time");
    h.post(
      FB_ORIGIN,
      finish({ data: { waba_id: "300000000000003", phone_number_id: "400000000000004" } }),
    );
    h.answer();
    expect(h.outcomes).toEqual([
      {
        kind: "ready",
        request: { code: "one-time", wabaId: "300000000000003", phoneNumberId: "400000000000004" },
      },
    ]);
  });

  it("ids that arrive after the code are still awaited", () => {
    const h = harness("one-time");
    h.answer();
    expect(h.outcomes).toEqual([]);
    vi.advanceTimersByTime(1000);
    h.post(
      FB_ORIGIN,
      finish({ data: { waba_id: "300000000000003", phone_number_id: "400000000000004" } }),
    );
    vi.advanceTimersByTime(200);
    expect(h.outcomes[0]?.kind).toBe("ready");
  });

  it("a foreign origin's ids are ignored, so the wait ends without ids", () => {
    const h = harness("one-time");
    h.post("https://evil.example", finish({ data: { waba_id: "3", phone_number_id: "4" } }));
    h.answer();
    vi.advanceTimersByTime(SIGNUP_IDS_WAIT_MS + 200);
    expect(h.outcomes).toEqual([{ kind: "missing_ids" }]);
  });

  it("CANCEL closes quietly", () => {
    const h = harness(null);
    h.post(FB_ORIGIN, { type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: {} });
    h.answer();
    expect(h.outcomes).toEqual([{ kind: "cancelled" }]);
  });

  it("no code means the window was closed", () => {
    const h = harness(null);
    h.answer();
    expect(h.outcomes).toEqual([{ kind: "closed" }]);
  });

  it("leaving the tab cancels the listener and the late-id wait", () => {
    const h = harness("one-time");
    h.answer();
    h.dispose();
    h.post(
      FB_ORIGIN,
      finish({ data: { waba_id: "300000000000003", phone_number_id: "400000000000004" } }),
    );
    vi.advanceTimersByTime(SIGNUP_IDS_WAIT_MS + 200);
    expect(h.outcomes).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
