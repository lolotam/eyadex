import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationKind,
  type NotificationSettings,
} from "@eyadex/contracts/notifications";
import { describe, expect, it } from "vitest";

import { parseNotificationEvent } from "../domain/notification-event.ts";
import { dueReminder } from "../domain/reminder-windows.ts";
import { onBehalfReplyTo, planRoutes } from "../domain/route-plan.ts";
import { notificationSkip, type SendFacts } from "../domain/skip-decision.ts";

const ID = "0192aaaa-0000-7000-8000-000000000001";
const CLINIC = "0192aaaa-0000-7000-8000-0000000000c1";

describe("parseNotificationEvent", () => {
  it("takes the ledger id from the payload and the clinic from the outbox row", () => {
    expect(parseNotificationEvent({ notificationId: ID }, CLINIC)).toEqual({
      clinicId: CLINIC,
      notificationId: ID,
    });
  });

  it.each([
    [{ notificationId: "not-a-uuid" }, CLINIC],
    [{ notificationId: ID, email: "x@example.invalid" }, CLINIC],
    [{}, CLINIC],
    [{ notificationId: ID }, null],
  ])("refuses %j on clinic %s", (payload, clinic) => {
    expect(parseNotificationEvent(payload, clinic)).toBeNull();
  });
});

const off = (change: (s: NotificationSettings) => NotificationSettings) =>
  change(structuredClone(DEFAULT_NOTIFICATION_SETTINGS));

const facts = (over: Partial<SendFacts> = {}): SendFacts => ({
  kind: "booked",
  settings: DEFAULT_NOTIFICATION_SETTINGS,
  patient: { email: "patient@example.invalid", optedOut: false },
  appointment: { status: "booked", startUnchanged: true },
  ...over,
});

describe("notificationSkip (spec §3.3)", () => {
  it("sends when everything still holds", () => {
    expect(notificationSkip(facts())).toBeNull();
  });

  it("email off → setting_off", () => {
    const settings = off((s) => ({ ...s, emailEnabled: false }));
    expect(notificationSkip(facts({ settings }))).toBe("setting_off");
  });

  it("the kind switched off → setting_off", () => {
    const settings = off((s) => ({ ...s, messages: { ...s.messages, booked: false } }));
    expect(notificationSkip(facts({ settings }))).toBe("setting_off");
    expect(notificationSkip(facts({ settings, kind: "rescheduled" }))).toBeNull();
  });

  it("no email → no_email", () => {
    expect(notificationSkip(facts({ patient: { email: null, optedOut: false } }))).toBe("no_email");
  });

  it.each<NotificationKind>(["reminder_day", "reminder_2h"])("opted out stops %s", (kind) => {
    const patient = { email: "patient@example.invalid", optedOut: true };
    expect(notificationSkip(facts({ kind, patient }))).toBe("opted_out");
  });

  it.each<NotificationKind>(["booked", "rescheduled", "cancelled"])(
    "opted out never stops %s (N-2)",
    (kind) => {
      const patient = { email: "patient@example.invalid", optedOut: true };
      const appointment = {
        status: kind === "cancelled" ? ("cancelled" as const) : ("booked" as const),
        startUnchanged: true,
      };
      expect(notificationSkip(facts({ kind, patient, appointment }))).toBeNull();
    },
  );

  it("opted out never stops the prescription", () => {
    const patient = { email: "patient@example.invalid", optedOut: true };
    expect(
      notificationSkip(facts({ kind: "prescription", patient, appointment: null })),
    ).toBeNull();
  });

  it.each(["arrived", "completed", "no_show", "cancelled"] as const)(
    "a reminder for an appointment now %s → not_booked",
    (status) => {
      const appointment = { status, startUnchanged: true };
      expect(notificationSkip(facts({ kind: "reminder_day", appointment }))).toBe("not_booked");
    },
  );

  it("the cancellation message goes out for a cancelled appointment", () => {
    const appointment = { status: "cancelled" as const, startUnchanged: true };
    expect(notificationSkip(facts({ kind: "cancelled", appointment }))).toBeNull();
  });

  it("a start that moved → moved", () => {
    const appointment = { status: "booked" as const, startUnchanged: false };
    expect(notificationSkip(facts({ kind: "reminder_2h", appointment }))).toBe("moved");
  });

  it("checks in the spec's order: the setting wins over a missing email and a moved start", () => {
    const settings = off((s) => ({ ...s, emailEnabled: false }));
    expect(
      notificationSkip(
        facts({
          settings,
          patient: { email: null, optedOut: true },
          appointment: { status: "cancelled", startUnchanged: false },
        }),
      ),
    ).toBe("setting_off");
    expect(
      notificationSkip(
        facts({
          kind: "reminder_day",
          patient: { email: "patient@example.invalid", optedOut: true },
          appointment: { status: "cancelled", startUnchanged: false },
        }),
      ),
    ).toBe("opted_out");
  });
});

const HOUR = 3_600_000;
const START = new Date("2026-11-02T09:00:00.000Z");
const at = (offsetMs: number) => new Date(START.getTime() + offsetMs);
const longAgo = at(-72 * HOUR);

describe("dueReminder (spec §3.2 windows)", () => {
  it.each([
    ["just before −24h", -24 * HOUR - 1, null],
    ["exactly −24h", -24 * HOUR, "reminder_day"],
    ["inside the day window", -10 * HOUR, "reminder_day"],
    ["just before −2h", -2 * HOUR - 1, "reminder_day"],
    ["exactly −2h", -2 * HOUR, "reminder_2h"],
    ["just before the start", -1, "reminder_2h"],
    ["exactly the start", 0, null],
    ["after the start", HOUR, null],
  ])("%s → %s", (_name, offset, expected) => {
    expect(dueReminder({ startsAt: START, createdAt: longAgo }, at(offset))).toBe(expected);
  });

  it("a booking made within 24 h of the start gets no day reminder", () => {
    expect(dueReminder({ startsAt: START, createdAt: at(-24 * HOUR) }, at(-20 * HOUR))).toBeNull();
    expect(dueReminder({ startsAt: START, createdAt: at(-23 * HOUR) }, at(-20 * HOUR))).toBeNull();
    expect(dueReminder({ startsAt: START, createdAt: at(-24 * HOUR - 1) }, at(-20 * HOUR))).toBe(
      "reminder_day",
    );
  });

  it("a booking made within 2 h of the start gets no 2 h reminder; one made earlier does", () => {
    expect(dueReminder({ startsAt: START, createdAt: at(-2 * HOUR) }, at(-HOUR))).toBeNull();
    expect(dueReminder({ startsAt: START, createdAt: at(-90 * 60_000) }, at(-HOUR))).toBeNull();
    expect(dueReminder({ startsAt: START, createdAt: at(-3 * HOUR) }, at(-HOUR))).toBe(
      "reminder_2h",
    );
  });
});

const health = (
  over: { verified?: boolean; degraded?: boolean; replyTo?: string | null } = {},
) => ({
  verifiedAt: over.verified === false ? null : new Date(),
  degradedAt: over.degraded ? new Date() : null,
  fromName: "Clinic Desk",
  fromEmail: "clinic@example.invalid",
  replyTo: over.replyTo === undefined ? "desk@example.invalid" : over.replyTo,
});

describe("planRoutes (N-3)", () => {
  it("primary → fallback → platform when both are verified and healthy", () => {
    expect(planRoutes(health(), health(), null)).toEqual(["primary", "fallback", "platform"]);
  });

  it.each([
    ["missing", null],
    ["unverified", health({ verified: false })],
    ["degraded", health({ degraded: true })],
  ])("a %s primary is passed over", (_name, primary) => {
    expect(planRoutes(primary, health(), null)).toEqual(["fallback", "platform"]);
  });

  it("no clinic provider at all → the platform alone", () => {
    expect(planRoutes(null, null, null)).toEqual(["platform"]);
  });

  it("resumes at the route an ambiguous failure stopped on, never earlier", () => {
    expect(planRoutes(health(), health(), "fallback")).toEqual(["fallback"]);
    expect(planRoutes(health(), health(), "platform")).toEqual(["platform"]);
    expect(planRoutes(health(), health({ degraded: true }), "fallback")).toEqual([]);
  });
});

describe("onBehalfReplyTo", () => {
  it("the primary's reply-to, else its from address, else the fallback's", () => {
    expect(onBehalfReplyTo(health(), null)).toBe("desk@example.invalid");
    expect(onBehalfReplyTo(health({ replyTo: null }), null)).toBe("clinic@example.invalid");
    expect(onBehalfReplyTo(null, health())).toBe("desk@example.invalid");
    expect(onBehalfReplyTo(null, null)).toBeNull();
  });
});
