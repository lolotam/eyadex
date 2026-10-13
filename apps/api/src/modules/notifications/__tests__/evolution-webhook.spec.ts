import { randomBytes } from "node:crypto";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { parseEvolutionWebhook } from "../domain/evolution-webhook.ts";
import { webhookAuthenticated } from "../domain/webhook-authentication.ts";
import { EvolutionWebhookGuard } from "../http/evolution-webhook.guard.ts";
import { FakeEvolution } from "./whatsapp-fake-evolution.ts";

const clinicId = "00000000-0000-7000-8000-000000000001";
const envelope = (data: unknown, event = "MESSAGES_UPDATE") => ({
  event,
  instance: `eyadex-${clinicId}`,
  data,
});
const context = (header?: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers: { "x-eyadex-webhook": header } }) }),
  }) as ExecutionContext;

describe("Evolution webhook parser", () => {
  it.each(["ERROR", 0])("reads status %s with either key id shape", (status) => {
    for (const key of [{ keyId: "msg" }, { key: { id: "msg" } }])
      expect(parseEvolutionWebhook(envelope({ status, ...key }))).toEqual([
        { kind: "rejected", clinicId, messageId: "msg" },
      ]);
  });
  it("reads arrays and Evolution's dotted lowercase event names", () => {
    expect(
      parseEvolutionWebhook(
        envelope(
          [
            { status: 0, keyId: "msg" },
            { status: "READ", keyId: "other" },
          ],
          "messages.update",
        ),
      ),
    ).toEqual([{ kind: "rejected", clinicId, messageId: "msg" }]);
    expect(parseEvolutionWebhook(envelope({ state: "close" }, "connection.update"))).toEqual([
      { kind: "closed", clinicId },
    ]);
  });
  it.each([
    null,
    {},
    { event: "MESSAGES_UPDATE", instance: "eyadex-no-uuid" },
    envelope({ status: "ERROR" }),
    envelope({ status: 0, keyId: "x".repeat(201) }),
    envelope({ state: "open" }, "CONNECTION_UPDATE"),
    envelope({}, "UNKNOWN"),
  ])("ignores unknown or malformed events", (body) => {
    expect(parseEvolutionWebhook(body)).toEqual([]);
  });
});
describe("Evolution webhook authentication and guard", () => {
  const secret = randomBytes(32).toString("hex");
  it("accepts only a single matching header", () => {
    expect(webhookAuthenticated(secret, secret)).toBe(true);
    for (const header of [undefined, null, "", secret.slice(1), `${secret}x`, [secret]])
      expect(webhookAuthenticated(header, secret)).toBe(false);
  });
  it("refuses a mismatch with the existing bilingual 401 envelope", () => {
    const guard = new EvolutionWebhookGuard(new FakeEvolution(), secret);
    expect(guard.canActivate(context(secret))).toBe(true);
    expect(() => guard.canActivate(context())).toThrow(
      expect.objectContaining({ status: 401, code: "unauthorized" }),
    );
  });
  it("is 404 when Evolution is unavailable", () => {
    const fake = new FakeEvolution();
    fake.configured = false;
    expect(() => new EvolutionWebhookGuard(fake, secret).canActivate(context(secret))).toThrow(
      expect.objectContaining({ status: 404 }),
    );
    expect(() =>
      new EvolutionWebhookGuard(new FakeEvolution(), null).canActivate(context(secret)),
    ).toThrow(expect.objectContaining({ status: 404 }));
  });
});
