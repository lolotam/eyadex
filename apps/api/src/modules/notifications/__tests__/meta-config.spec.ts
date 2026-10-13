import { createHmac, randomBytes } from "node:crypto";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { MetaWebhookGuard } from "../http/meta-webhook.guard.ts";
import { metaConfigFromEnv } from "../persistence/meta-config.ts";

// Shaped placeholders, never a real Meta app.
const FULL = {
  META_APP_ID: "1234567890",
  META_APP_SECRET: randomBytes(16).toString("hex"),
  META_WHATSAPP_CONFIG_ID: "9876543210",
  META_WEBHOOK_VERIFY_TOKEN: randomBytes(32).toString("hex"),
};

describe("Meta app configuration (spec §7.2)", () => {
  it("all unset = both features off", () => {
    expect(metaConfigFromEnv({})).toBeNull();
    expect(metaConfigFromEnv({ META_APP_ID: "" })).toBeNull();
  });

  it("all four set = the app", () => {
    expect(metaConfigFromEnv(FULL)).toEqual({
      appId: FULL.META_APP_ID,
      appSecret: FULL.META_APP_SECRET,
      configId: FULL.META_WHATSAPP_CONFIG_ID,
      verifyToken: FULL.META_WEBHOOK_VERIFY_TOKEN,
    });
  });

  it.each(Object.keys(FULL))("a partial set without %s stops the start naming it", (name) => {
    const error = (() => {
      try {
        metaConfigFromEnv({ ...FULL, [name]: "" });
      } catch (e) {
        return e as Error;
      }
      return null;
    })();
    expect(error?.message).toContain(name);
    for (const value of Object.values(FULL)) expect(error?.message).not.toContain(value);
  });

  it.each([
    ["META_APP_ID", "12a45"],
    ["META_APP_ID", "1234"],
    ["META_WHATSAPP_CONFIG_ID", "x".repeat(10)],
    ["META_WEBHOOK_VERIFY_TOKEN", "x".repeat(31)],
  ])("%s = %s is refused", (name, value) => {
    expect(() => metaConfigFromEnv({ ...FULL, [name]: value })).toThrow(name);
  });
});

describe("MetaWebhookGuard", () => {
  const config = metaConfigFromEnv(FULL)!;
  const raw = Buffer.from('{"entry":[]}');
  const context = (method: string, signature?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ method, headers: { "x-hub-signature-256": signature } }),
      }),
    }) as ExecutionContext;

  it("is 404 for both methods without the Meta app", () => {
    for (const method of ["GET", "POST"])
      expect(() => new MetaWebhookGuard(null).canActivate(context(method))).toThrow(
        expect.objectContaining({ status: 404 }),
      );
  });

  it("lets the GET through to its token check, and refuses an unsigned POST with 401", () => {
    expect(new MetaWebhookGuard(config).canActivate(context("GET"))).toBe(true);
    // No raw body was captured for this fake request: nothing a signature could match.
    const signed = `sha256=${createHmac("sha256", config.appSecret).update(raw).digest("hex")}`;
    expect(() => new MetaWebhookGuard(config).canActivate(context("POST", signed))).toThrow(
      expect.objectContaining({ status: 401, code: "unauthorized" }),
    );
  });
});
