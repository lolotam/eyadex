import { describe, expect, it } from "vitest";
import { notificationFailureReason } from "../notification-failure-reason.ts";

describe("notificationFailureReason", () => {
  it.each([
    ["evolution:evo_delivery_rejected", "delivery_rejected"],
    ["evo_not_on_whatsapp", "not_on_whatsapp"],
    ["coexistence:meta_not_on_whatsapp", "not_on_whatsapp"],
    ["evo_unauthorized", "whatsapp_credentials"],
    ["meta_unauthorized", "whatsapp_credentials"],
    ["meta_template", "template"],
    ["template_missing", "template"],
    ["template_invalid", "template"],
    ["template:invalid", "template"],
    ["evolution:evo_not_connected", "disconnected"],
    ["evo_timeout", "unconfirmed"],
    ["meta_timeout", "unconfirmed"],
    ["ambiguous_provider_unknown", "unconfirmed"],
    ["ambiguous_provider_unavailable", "unconfirmed"],
    ["platform:resend_unconfirmed", "unconfirmed"],
    ["primary:smtp_ambiguous", "unconfirmed"],
    ["primary:smtp_timeout_after_data:00000000-0000-7000-8000-000000000001:1", "unconfirmed"],
    ["platform:route_timeout", "unconfirmed"],
    ["fallback:resend_timeout", "unconfirmed"],
    ["platform:resend_network", "unconfirmed"],
    ["invalid_phone", "invalid_address"],
    ["no_email", "invalid_address"],
    ["invalid_email", "invalid_address"],
    ["fallback:invalid_address", "invalid_address"],
    ["primary:resend_422:invalid_email_address", "invalid_address"],
    ["smtp_invalid_address", "invalid_address"],
    ["something_else", "other"],
    [null, "other"],
  ])("%s → %s", (code, reason) => expect(notificationFailureReason("failed", code)).toBe(reason));
  it.each(["queued", "sent", "skipped"] as const)("%s never exposes a failure reason", (status) => {
    expect(notificationFailureReason(status, "evolution:evo_delivery_rejected")).toBeNull();
  });
});
