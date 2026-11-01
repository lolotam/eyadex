import { describe, expect, it } from "vitest";

import { parseBranchDeactivated } from "../../branch-invitations/domain/branch-event.ts";
import { parseReminderEvent } from "../../expiry-reminder/domain/reminder-rules.ts";
import {
  ADMIN_INVITED,
  parseInvitationEvent,
  USER_INVITED,
} from "../../invitation-mail/domain/invitation-event.ts";
import { parseMailProviderTest } from "../../mail-provider-test/domain/test-event.ts";
import { parseNotificationEvent } from "../../patient-notifications/domain/notification-event.ts";
import { parseTeamInvite } from "../../platform-invite-mail/domain/team-invite.ts";

// Installed zod@3.25.76 uuid() is the loose hex form. A later strict uuid() would drop stored ids.
const variant1 = "11111111-1111-1111-1111-111111111111";
const upper = "01920000-0000-7000-8000-00000000C001";
const nil = "00000000-0000-0000-0000-000000000000";
const maxId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const variant0 = "01920000-0000-7000-0000-00000000c001";
const variantC = "01920000-0000-7000-c000-00000000c001";
const LOOSE_IDS = [
  ["variant 1", variant1],
  ["uppercase", upper],
  ["nil", nil],
  ["max", maxId],
  ["variant 0", variant0],
  ["variant c", variantC],
] as const;
const OTHER = "01920000-0000-7000-8000-00000000c0aa";
const EMAIL = "Owner@Example.Test";
// Seconds are optional, and +HHMM has no clock range, on this parser.
const OFFSET_INSTANTS = [
  "2026-10-26T00:00Z",
  "2026-10-26T00:00+03:00",
  "2026-10-26T00:00+0300",
  "2026-10-26T12:00:00+24:00",
] as const;

describe("parseBranchDeactivated on Zod 3.25.76", () => {
  it.each(LOOSE_IDS)("keeps a %s id and a compact offset", (_label, id) => {
    const payload = {
      clinicId: id,
      branchId: id,
      actorUserId: id,
      deactivatedAt: "2026-10-26T00:00+0300",
    };
    expect(parseBranchDeactivated(payload, id)).toEqual(payload);
  });

  it.each(OFFSET_INSTANTS)("keeps offset instant %s", (deactivatedAt) => {
    const payload = {
      clinicId: variant1,
      branchId: upper,
      actorUserId: nil,
      deactivatedAt,
    };
    expect(parseBranchDeactivated(payload, variant1)).toEqual(payload);
  });

  it.each([
    ["an extra key", { extra: true }, variant1],
    ["another clinic row", {}, OTHER],
    ["a null clinic row", {}, null],
    ["a trailing newline id", { clinicId: `${variant1}\n` }, `${variant1}\n`],
    ["an instant with no zone", { deactivatedAt: "2026-10-26T00:00:00" }, variant1],
  ])("returns null for %s", (_label, change, rowClinic) => {
    expect(
      parseBranchDeactivated(
        {
          clinicId: variant1,
          branchId: variant1,
          actorUserId: variant1,
          deactivatedAt: "2026-10-26T00:00:00Z",
          ...change,
        },
        rowClinic,
      ),
    ).toBeNull();
  });
});

describe("parseInvitationEvent on Zod 3.25.76", () => {
  const payload = (id: string, expiresAt: string, extra: Record<string, string> = {}) => ({
    clinicId: id,
    invitationId: id,
    email: EMAIL,
    fullName: "Synthetic Staff",
    language: "ar",
    clinicNameAr: "Synthetic",
    clinicNameEn: "Synthetic",
    expiresAt,
    sealedToken: "sealed-marker",
    ...extra,
  });
  const mapped = (id: string, role: { ar: string; en: string } | null) => ({
    clinicId: id,
    invitationId: id,
    email: EMAIL,
    fullName: "Synthetic Staff",
    language: "ar",
    clinicName: { ar: "Synthetic", en: "Synthetic" },
    sealedToken: "sealed-marker",
    role,
  });

  it.each(LOOSE_IDS)("keeps a %s id and does not lowercase the address", (_label, id) => {
    expect(parseInvitationEvent(ADMIN_INVITED, payload(id, "2026-10-26T00:00+0300"))).toEqual(
      mapped(id, null),
    );
  });

  it.each(OFFSET_INSTANTS)("accepts %s and does not return the instant", (expiresAt) => {
    expect(
      parseInvitationEvent(
        USER_INVITED,
        payload(variant1, expiresAt, { roleNameAr: "Synthetic", roleNameEn: "Synthetic" }),
      ),
    ).toEqual(mapped(variant1, { ar: "Synthetic", en: "Synthetic" }));
  });

  it("strips an unknown top-level key", () => {
    expect(
      parseInvitationEvent(ADMIN_INVITED, payload(variant1, "2026-10-26T00:00Z", { mystery: "x" })),
    ).toEqual(mapped(variant1, null));
  });

  it.each([
    ["an unknown type", "clinic.other", payload(variant1, "2026-10-26T00:00Z")],
    [
      "a bad address",
      ADMIN_INVITED,
      payload(variant1, "2026-10-26T00:00Z", { email: "not-an-email" }),
    ],
    ["no zone", ADMIN_INVITED, payload(variant1, "2026-10-26T00:00:00")],
    ["a trailing newline id", ADMIN_INVITED, payload(`${variant1}\n`, "2026-10-26T00:00Z")],
  ])("returns null for %s", (_label, type, body) => {
    expect(parseInvitationEvent(type, body)).toBeNull();
  });
});

describe("parseReminderEvent on Zod 3.25.76", () => {
  const payload = (id: string, expiresAt: string, daysLeft = 1) => ({
    clinicId: id,
    reminderId: id,
    expiresAt,
    membershipId: id,
    daysLeft,
  });

  it.each(LOOSE_IDS)("keeps a %s id and a minute-only UTC instant", (_label, id) => {
    const body = payload(id, "2026-10-26T00:00Z");
    expect(parseReminderEvent(body, id)).toEqual(body);
  });

  it("keeps daysLeft 60 and rejects 0 and 61", () => {
    expect(parseReminderEvent(payload(variant1, "2026-10-26T00:00:00Z", 60), variant1)).toEqual(
      payload(variant1, "2026-10-26T00:00:00Z", 60),
    );
    expect(parseReminderEvent(payload(variant1, "2026-10-26T00:00:00Z", 0), variant1)).toBeNull();
    expect(parseReminderEvent(payload(variant1, "2026-10-26T00:00:00Z", 61), variant1)).toBeNull();
  });

  it.each([
    ["an offset instant", payload(variant1, "2026-10-26T00:00:00+0300"), variant1],
    ["an extra key", { ...payload(variant1, "2026-10-26T00:00Z"), extra: 1 }, variant1],
    ["another clinic row", payload(variant1, "2026-10-26T00:00Z"), OTHER],
    ["a null clinic row", payload(variant1, "2026-10-26T00:00Z"), null],
  ])("returns null for %s", (_label, body, rowClinic) => {
    expect(parseReminderEvent(body, rowClinic)).toBeNull();
  });
});

describe("parseTeamInvite on Zod 3.25.76", () => {
  const payload = (accountId: string, expiresAt: string) => ({
    accountId,
    email: EMAIL,
    fullName: "Synthetic Staff",
    expiresAt,
    sealedToken: "sealed-marker",
  });

  it.each(LOOSE_IDS)("keeps a %s id only when the row clinic is null", (_label, id) => {
    const body = payload(id, "2026-10-26T00:00Z");
    expect(parseTeamInvite(body, null)).toEqual(body);
    expect(parseTeamInvite(body, id)).toBeNull();
  });

  it("rejects an offset, an extra key, and a trailing newline id", () => {
    expect(parseTeamInvite(payload(variant1, "2026-10-26T00:00:00+00:00"), null)).toBeNull();
    expect(
      parseTeamInvite({ ...payload(variant1, "2026-10-26T00:00Z"), extra: 1 }, null),
    ).toBeNull();
    expect(parseTeamInvite(payload(`${variant1}\n`, "2026-10-26T00:00Z"), null)).toBeNull();
  });
});

describe("parseMailProviderTest on Zod 3.25.76", () => {
  it.each(LOOSE_IDS)("keeps a %s id and defaults a missing slot to primary", (_label, id) => {
    const body = { clinicId: id, providerId: id, providerVersion: 1, actorUserId: id };
    expect(parseMailProviderTest(body, id)).toEqual({ ...body, slot: "primary" });
  });

  it("keeps fallback and rejects a bad version, an extra key, and another clinic", () => {
    const body = {
      clinicId: variant1,
      providerId: nil,
      actorUserId: upper,
      providerVersion: 1,
      slot: "fallback",
    };
    expect(parseMailProviderTest(body, variant1)).toEqual(body);
    expect(parseMailProviderTest({ ...body, providerVersion: 0 }, variant1)).toBeNull();
    expect(parseMailProviderTest({ ...body, providerVersion: 1.5 }, variant1)).toBeNull();
    expect(parseMailProviderTest({ ...body, extra: 1 }, variant1)).toBeNull();
    expect(parseMailProviderTest(body, OTHER)).toBeNull();
  });
});

describe("parseNotificationEvent on Zod 3.25.76", () => {
  it.each(LOOSE_IDS)("keeps a %s ledger id and copies the row clinic", (_label, id) => {
    expect(parseNotificationEvent({ notificationId: id }, upper)).toEqual({
      clinicId: upper,
      notificationId: id,
    });
  });

  it("requires a non-null row clinic and does not read a clinic from the payload", () => {
    expect(parseNotificationEvent({ notificationId: variant1 }, null)).toBeNull();
    expect(parseNotificationEvent({ notificationId: variant1, clinicId: upper }, upper)).toBeNull();
    expect(parseNotificationEvent({ notificationId: `${variant1}\n` }, upper)).toBeNull();
    // The row clinic is not parsed, so a uuid swap must not start rejecting it.
    expect(parseNotificationEvent({ notificationId: upper }, "row-clinic")).toEqual({
      clinicId: "row-clinic",
      notificationId: upper,
    });
  });
});
