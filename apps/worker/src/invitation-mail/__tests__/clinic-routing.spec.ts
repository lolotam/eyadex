import { describe, expect, it } from "vitest";

import {
  afterDefinitiveFailure,
  DEGRADE_AFTER,
  isDefinitiveClinicFailure,
} from "../domain/clinic-failure.ts";
import { routeInvitation, type ProviderHealth } from "../domain/clinic-routing.ts";
import { ADMIN_INVITED, USER_INVITED } from "../domain/invitation-event.ts";
import { addressOf } from "../domain/mail-address.ts";

describe("clinic provider failure classification (ADR-0014 7c-2b)", () => {
  it.each([
    "resend_500",
    "resend_503",
    "resend_502:internal_server_error",
    "resend_unreachable",
    "resend_401",
    "resend_403",
    "smtp_econnrefused",
    "smtp_econnection",
    "smtp_econnreset",
    "smtp_ehostunreach",
    "smtp_enetunreach",
    "smtp_auth",
    "smtp_550",
    "smtp_dns",
    "smtp_blocked_address",
    "smtp_port_not_allowed",
    "seal_unreadable",
  ])("%s counts", (code) => {
    expect(isDefinitiveClinicFailure(code)).toBe(true);
  });

  it.each([
    "resend_timeout",
    "smtp_timeout",
    "resend_network",
    "resend_429",
    "resend_422:validation_error",
    "smtp_421",
    "smtp_error",
    "invalid_provider",
  ])("%s retries but does not count", (code) => {
    expect(isDefinitiveClinicFailure(code)).toBe(false);
  });

  it("degrades on the third consecutive definitive failure", () => {
    expect(DEGRADE_AFTER).toBe(3);
    expect(afterDefinitiveFailure(0)).toEqual({ failures: 1, degrade: false });
    expect(afterDefinitiveFailure(1)).toEqual({ failures: 2, degrade: false });
    expect(afterDefinitiveFailure(2)).toEqual({ failures: 3, degrade: true });
  });
});

const health = (over: Partial<ProviderHealth> = {}): ProviderHealth => ({
  verifiedAt: new Date("2026-10-01T00:00:00Z"),
  degradedAt: null,
  fromName: "Clinic",
  fromEmail: "clinic@example.test",
  replyTo: null,
  ...over,
});

describe("invitation routing", () => {
  it.each([
    ["no provider", USER_INVITED, null, { kind: "platform" }],
    ["unverified", USER_INVITED, health({ verifiedAt: null }), { kind: "platform" }],
    ["healthy", USER_INVITED, health(), { kind: "clinic" }],
    ["admin invite, healthy provider", ADMIN_INVITED, health(), { kind: "platform" }],
    [
      "degraded, no reply-to",
      USER_INVITED,
      health({ degradedAt: new Date() }),
      { kind: "platform_on_behalf", fromName: "Clinic", replyTo: "clinic@example.test" },
    ],
    [
      "degraded with reply-to",
      USER_INVITED,
      health({ degradedAt: new Date(), replyTo: "desk@example.test" }),
      { kind: "platform_on_behalf", fromName: "Clinic", replyTo: "desk@example.test" },
    ],
  ] as const)("%s", (_name, type, provider, expected) => {
    expect(routeInvitation(type, provider)).toEqual(expected);
  });

  it("takes the bare platform address from MAIL_FROM", () => {
    expect(addressOf("Eyadex <noreply@example.test>")).toBe("noreply@example.test");
    expect(addressOf("noreply@example.test")).toBe("noreply@example.test");
  });
});
