import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NOTIFICATION_KINDS,
  type NotificationSettings,
} from "@eyadex/contracts/notifications";
import { describe, expect, it } from "vitest";

import { queuedChannels, sameSettings, subjectOf, wantsWhatsapp } from "../notification-rules.ts";

const ID = "0190a000-0000-7000-8000-0000000000aa";

const withMessage = (
  kind: keyof NotificationSettings["messages"],
  on: boolean,
): NotificationSettings => ({
  ...DEFAULT_NOTIFICATION_SETTINGS,
  messages: { ...DEFAULT_NOTIFICATION_SETTINGS.messages, [kind]: on },
});

describe("queuedChannels (N-1, spec §7.1)", () => {
  const whatsappOn: NotificationSettings = {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    whatsappEnabled: true,
  };

  it("queues every message by email for a clinic that never saved its settings", () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(queuedChannels(DEFAULT_NOTIFICATION_SETTINGS, kind, true)).toEqual(["email"]);
    }
  });

  it("queues nothing by email when the email channel is off, whatever the message switch", () => {
    const off = { ...DEFAULT_NOTIFICATION_SETTINGS, emailEnabled: false };
    for (const kind of NOTIFICATION_KINDS) expect(queuedChannels(off, kind, false)).toEqual([]);
  });

  it("a message switched off is not queued on any channel; the others still are", () => {
    const settings = { ...withMessage("cancelled", false), whatsappEnabled: true };
    expect(queuedChannels(settings, "cancelled", true)).toEqual([]);
    expect(queuedChannels(settings, "booked", true)).toEqual(["email", "whatsapp"]);
  });

  it("adds WhatsApp only when the clinic turned it on and the channel is connected now", () => {
    expect(queuedChannels(whatsappOn, "booked", true)).toEqual(["email", "whatsapp"]);
    expect(queuedChannels(whatsappOn, "booked", false)).toEqual(["email"]);
    expect(queuedChannels(DEFAULT_NOTIFICATION_SETTINGS, "booked", true)).toEqual(["email"]);
    const whatsappOnly = { ...whatsappOn, emailEnabled: false };
    expect(queuedChannels(whatsappOnly, "reminder_2h", true)).toEqual(["whatsapp"]);
  });

  it("asks for the channel state only when WhatsApp could take the message", () => {
    expect(wantsWhatsapp(whatsappOn, "prescription")).toBe(true);
    expect(wantsWhatsapp(DEFAULT_NOTIFICATION_SETTINGS, "prescription")).toBe(false);
    const switchedOff = { ...withMessage("prescription", false), whatsappEnabled: true };
    expect(wantsWhatsapp(switchedOff, "prescription")).toBe(false);
  });
});

describe("subjectOf (0056 subject check)", () => {
  it("an appointment message names the start, normalised to UTC ISO", () => {
    expect(subjectOf("rescheduled", ID, "2027-03-07T10:00:00+03:00")).toEqual({
      subjectType: "appointment",
      subjectId: ID,
      subjectAt: "2027-03-07T07:00:00.000Z",
    });
  });

  it("the prescription is a visit message without a start", () => {
    expect(subjectOf("prescription", ID, null)).toEqual({
      subjectType: "visit",
      subjectId: ID,
      subjectAt: null,
    });
  });

  it("refuses a mismatch the database would refuse", () => {
    expect(() => subjectOf("booked", ID, null)).toThrow();
    expect(() => subjectOf("prescription", ID, "2027-03-07T07:00:00.000Z")).toThrow();
  });
});

describe("sameSettings", () => {
  it("is true only when the channel and every switch match", () => {
    expect(sameSettings(DEFAULT_NOTIFICATION_SETTINGS, withMessage("booked", true))).toBe(true);
    expect(sameSettings(DEFAULT_NOTIFICATION_SETTINGS, withMessage("reminder_2h", false))).toBe(
      false,
    );
    expect(
      sameSettings(DEFAULT_NOTIFICATION_SETTINGS, {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        emailEnabled: false,
      }),
    ).toBe(false);
    expect(
      sameSettings(DEFAULT_NOTIFICATION_SETTINGS, {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        whatsappEnabled: true,
      }),
    ).toBe(false);
  });
});
