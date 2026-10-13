import { NOTIFICATION_KINDS } from "@eyadex/contracts/notifications";
import {
  WHATSAPP_RISK_VERSION,
  whatsappChannelViewSchema,
  type WhatsappCoexistenceRequest,
} from "@eyadex/contracts/whatsapp";
import { describe, expect, it } from "vitest";

import {
  channelView,
  coexistenceNeedsVerification,
  coexistenceRefusal,
  coexistenceUnchanged,
  evolutionLinkRefusal,
  instanceNameFor,
  last4FromOwnerJid,
  qrDataUrlOf,
  riskToRecord,
  templatesOf,
  type ChannelRecord,
} from "../whatsapp-rules.ts";

const CLINIC = "0190a000-0000-7000-8000-0000000000aa";
const NONE = templatesOf({});
const BOOKED = { name: "booking_ok", language: "ar" };

const channel = (over: Partial<ChannelRecord> = {}): ChannelRecord => ({
  id: "0190a000-0000-7000-8000-0000000000bb",
  transport: null,
  status: "disconnected",
  instanceName: null,
  phoneLast4: null,
  riskAcceptedAt: null,
  riskAcceptedBy: null,
  riskVersion: null,
  sealedCredentials: null,
  phoneNumberId: null,
  businessAccountId: null,
  templates: NONE,
  connectedAt: null,
  lastError: null,
  ...over,
});

const coexistence = channel({
  transport: "coexistence",
  status: "connected",
  instanceName: null,
  sealedCredentials: "v1.a.b.c",
  phoneNumberId: "123456789",
  businessAccountId: "987654321",
  templates: { ...NONE, booked: BOOKED },
  connectedAt: new Date("2027-01-01T00:00:00Z"),
});

const request = (over: Partial<WhatsappCoexistenceRequest> = {}): WhatsappCoexistenceRequest => ({
  phoneNumberId: "123456789",
  businessAccountId: "987654321",
  templates: { ...NONE, booked: BOOKED },
  ...over,
});

describe("instance name and the linked number", () => {
  it("names the clinic's Evolution instance after the clinic", () => {
    expect(instanceNameFor(CLINIC)).toBe(`eyadex-${CLINIC}`);
  });

  it("keeps only the last four digits of the owner JID, device suffix or not", () => {
    expect(last4FromOwnerJid("96512345678@s.whatsapp.net")).toBe("5678");
    expect(last4FromOwnerJid("96512345678:12@s.whatsapp.net")).toBe("5678");
  });

  it("knows no number for anything that is not a JID of digits", () => {
    for (const value of [null, undefined, 42, "", "abc@s.whatsapp.net", "123@s.whatsapp.net"]) {
      expect(last4FromOwnerJid(value)).toBeNull();
    }
  });

  it("passes on a PNG data URL only", () => {
    const qr = "data:image/png;base64,iVBORw0KGgo=";
    expect(qrDataUrlOf(qr)).toBe(qr);
    expect(qrDataUrlOf("iVBORw0KGgo=")).toBe(qr);
    for (const value of [undefined, "", "2@abc,def", "data:image/svg+xml;base64,PHN2Zz4=", 7]) {
      expect(qrDataUrlOf(value)).toBeNull();
    }
  });
});

describe("the risk acceptance", () => {
  it("is recorded the first time and again only for a newer risk text", () => {
    expect(riskToRecord(null)).toBe(true);
    expect(riskToRecord(channel())).toBe(true);
    expect(riskToRecord(channel({ riskVersion: WHATSAPP_RISK_VERSION }))).toBe(false);
    expect(riskToRecord(channel({ riskVersion: WHATSAPP_RISK_VERSION - 1 }))).toBe(true);
  });
});

describe("transport refusals", () => {
  it("refuses an Evolution link while a coexistence number is linked", () => {
    expect(evolutionLinkRefusal(coexistence)).toEqual({
      path: "transport",
      code: "coexistence_linked",
    });
    expect(evolutionLinkRefusal({ ...coexistence, status: "disconnected" })).toBeNull();
    expect(evolutionLinkRefusal(null)).toBeNull();
  });

  it("refuses coexistence while an Evolution number is linked or being linked", () => {
    for (const status of ["pending", "connected"] as const) {
      expect(coexistenceRefusal(channel({ transport: "evolution", status }), true)).toEqual({
        path: "transport",
        code: "evolution_linked",
      });
    }
    expect(coexistenceRefusal(channel({ transport: "evolution" }), true)).toBeNull();
  });

  it("needs a token on the first save, and keeps the stored one after that", () => {
    expect(coexistenceRefusal(null, false)).toEqual({ path: "accessToken", code: "required" });
    expect(coexistenceRefusal(null, true)).toBeNull();
    expect(coexistenceRefusal(coexistence, false)).toBeNull();
  });
});

describe("coexistence changes", () => {
  it("verifies Meta credentials for a first link, another transport, a new token or new Meta ids", () => {
    expect(coexistenceNeedsVerification(null, request(), true)).toBe(true);
    expect(
      coexistenceNeedsVerification(channel({ transport: "evolution" }), request(), false),
    ).toBe(true);
    expect(coexistenceNeedsVerification(coexistence, request(), true)).toBe(true);
    expect(
      coexistenceNeedsVerification(coexistence, request({ phoneNumberId: "11111" }), false),
    ).toBe(true);
    expect(
      coexistenceNeedsVerification({ ...coexistence, status: "disconnected" }, request(), false),
    ).toBe(true);
  });

  it("skips verification when only the templates change, and sees nothing to do for the same body", () => {
    const other = request({ templates: { ...NONE, booked: { name: "other", language: "en" } } });
    expect(coexistenceNeedsVerification(coexistence, other, false)).toBe(false);
    expect(coexistenceUnchanged(coexistence, other, false)).toBe(false);
    expect(coexistenceUnchanged(coexistence, request(), false)).toBe(true);
    expect(coexistenceUnchanged(null, request(), false)).toBe(false);
  });
});

describe("the channel view", () => {
  it("answers an unlinked channel for a clinic without a row", () => {
    const view = whatsappChannelViewSchema.parse(channelView(null));
    expect(view).toMatchObject({ transport: null, status: "disconnected", hasCredentials: false });
    expect(Object.keys(view.templates).sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });

  it("says credentials exist without ever carrying them", () => {
    const view = whatsappChannelViewSchema.parse(channelView(coexistence));
    expect(view.hasCredentials).toBe(true);
    expect(JSON.stringify(view)).not.toContain("v1.a.b.c");
    expect(view.connectedAt).toBe("2027-01-01T00:00:00.000Z");
  });

  it("reads stored templates by kind and drops malformed ones", () => {
    const read = templatesOf({ booked: BOOKED, cancelled: { name: "Bad Name" }, extra: BOOKED });
    expect(read.booked).toEqual(BOOKED);
    expect(read.cancelled).toBeNull();
    expect(Object.keys(read)).toEqual([...NOTIFICATION_KINDS]);
  });
});
