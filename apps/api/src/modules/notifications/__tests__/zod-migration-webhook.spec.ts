import { describe, expect, it } from "vitest";
import { parseEvolutionWebhook } from "../domain/evolution-webhook.ts";

// Installed zod@3.25.76 uuid() accepts these after the eyadex- prefix. Output keeps the text.
const variant1 = "11111111-1111-1111-1111-111111111111";
const upper = "01920000-0000-7000-8000-00000000C001";
const LOOSE_IDS = [
  ["variant 1", variant1],
  ["uppercase", upper],
  ["nil", "00000000-0000-0000-0000-000000000000"],
  ["max", "ffffffff-ffff-ffff-ffff-ffffffffffff"],
  ["variant 0", "01920000-0000-7000-0000-00000000c001"],
  ["variant c", "01920000-0000-7000-c000-00000000c001"],
] as const;

describe("parseEvolutionWebhook ids on Zod 3.25.76", () => {
  it.each(LOOSE_IDS)("closes on a %s clinic id without rewriting it", (_label, clinicId) => {
    expect(
      parseEvolutionWebhook({
        event: "connection.update",
        instance: `eyadex-${clinicId}`,
        data: { state: "close" },
      }),
    ).toEqual([{ kind: "closed", clinicId }]);
  });

  it("keeps a loose id on a rejected message and ignores a non-outcome status", () => {
    expect(
      parseEvolutionWebhook({
        event: "messages.update",
        instance: `eyadex-${upper}`,
        data: { status: "ERROR", keyId: "msg" },
      }),
    ).toEqual([{ kind: "rejected", clinicId: upper, messageId: "msg" }]);
    expect(
      parseEvolutionWebhook({
        event: "messages.update",
        instance: `eyadex-${variant1}`,
        data: { status: "SERVER_ACK", keyId: "msg" },
      }),
    ).toEqual([]);
  });

  it.each([
    ["no prefix", variant1],
    ["a bad id", `eyadex-not-a-uuid`],
    ["a short id", `eyadex-${variant1.slice(0, -1)}`],
    ["a trailing newline", `eyadex-${variant1}\n`],
  ])("returns nothing for %s", (_label, instance) => {
    expect(
      parseEvolutionWebhook({
        event: "connection.update",
        instance,
        data: { state: "close" },
      }),
    ).toEqual([]);
  });

  it("ignores an open connection and an unknown event", () => {
    expect(
      parseEvolutionWebhook({
        event: "connection.update",
        instance: `eyadex-${variant1}`,
        data: { state: "open" },
      }),
    ).toEqual([]);
    expect(
      parseEvolutionWebhook({
        event: "unknown.event",
        instance: `eyadex-${variant1}`,
        data: { state: "close" },
      }),
    ).toEqual([]);
  });
});
