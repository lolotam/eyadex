import { describe, expect, it } from "vitest";

import {
  applyDeliveryUpdate,
  metaDeliveryFailureCode,
  type DeliveryState,
} from "../delivery-status.ts";

const T1 = new Date("2027-01-01T10:00:00.000Z");
const T2 = new Date("2027-01-01T10:05:00.000Z");
const T3 = new Date("2027-01-01T10:09:00.000Z");
const sent: DeliveryState = { status: "sent", deliveredAt: null, readAt: null, lastError: null };

describe("applyDeliveryUpdate — forward only (spec §7.2)", () => {
  it("sent → delivered → read", () => {
    const delivered = applyDeliveryUpdate(sent, "coexistence", { kind: "delivered", at: T1 });
    expect(delivered).toEqual({ ...sent, deliveredAt: T1 });
    expect(applyDeliveryUpdate(delivered!, "coexistence", { kind: "read", at: T2 })).toEqual({
      ...sent,
      deliveredAt: T1,
      readAt: T2,
    });
  });

  it("a read before its delivered sets both, and the late delivered changes nothing", () => {
    const read = applyDeliveryUpdate(sent, "evolution", { kind: "read", at: T2 });
    expect(read).toEqual({ ...sent, deliveredAt: T2, readAt: T2 });
    expect(applyDeliveryUpdate(read!, "evolution", { kind: "delivered", at: T1 })).toBeNull();
  });

  it("never dates a read before the delivery it follows", () => {
    const delivered = { ...sent, deliveredAt: T3 };
    expect(applyDeliveryUpdate(delivered, "coexistence", { kind: "read", at: T2 })).toEqual({
      ...delivered,
      readAt: T3,
    });
  });

  it("replays are no-ops", () => {
    const done = { ...sent, deliveredAt: T1, readAt: T2 };
    expect(applyDeliveryUpdate(done, "coexistence", { kind: "delivered", at: T3 })).toBeNull();
    expect(applyDeliveryUpdate(done, "coexistence", { kind: "read", at: T3 })).toBeNull();
    const failed = { ...done, status: "failed" as const, lastError: "coexistence:meta_rejected" };
    expect(
      applyDeliveryUpdate(failed, "coexistence", { kind: "failed", code: "meta_template" }),
    ).toBeNull();
  });

  it("a failure after acceptance fails the row with its transport's code and keeps the times", () => {
    const delivered = { ...sent, deliveredAt: T1 };
    expect(
      applyDeliveryUpdate(delivered, "coexistence", { kind: "failed", code: "meta_rejected" }),
    ).toEqual({ ...delivered, status: "failed", lastError: "coexistence:meta_rejected" });
    expect(
      applyDeliveryUpdate(sent, "evolution", { kind: "failed", code: "evo_delivery_rejected" }),
    ).toEqual({ ...sent, status: "failed", lastError: "evolution:evo_delivery_rejected" });
  });

  it.each(["queued", "skipped", "failed"] as const)("a %s row never moves", (status) => {
    const row = { ...sent, status };
    expect(applyDeliveryUpdate(row, "coexistence", { kind: "delivered", at: T1 })).toBeNull();
    expect(applyDeliveryUpdate(row, "coexistence", { kind: "read", at: T1 })).toBeNull();
    expect(
      applyDeliveryUpdate(row, "coexistence", { kind: "failed", code: "meta_rejected" }),
    ).toBeNull();
  });
});

describe("metaDeliveryFailureCode", () => {
  it.each([
    [131026, "meta_not_on_whatsapp"],
    [131047, "meta_rejected"],
    [131049, "meta_rejected"],
    [131051, "meta_rejected"],
    [131048, "meta_rate_limited"],
    [131056, "meta_rate_limited"],
    [130429, "meta_rate_limited"],
    [132000, "meta_template"],
    [132015, "meta_template"],
    [132016, "meta_rejected"],
    [131999, "meta_rejected"],
    [null, "meta_rejected"],
  ])("%s → %s", (code, mapped) => expect(metaDeliveryFailureCode(code)).toBe(mapped));
});
