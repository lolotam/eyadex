import { describe, expect, it } from "vitest";

import { certainlyNotAccepted, failureCode, resumeRoute } from "../domain/route-advance.ts";

describe("certainlyNotAccepted (spec §3.3)", () => {
  it.each([
    // Resend: the existing decideFallback rule.
    ["resend_unreachable", true],
    ["resend_500", true],
    ["resend_503:internal_server_error", true],
    ["resend_timeout", false],
    ["resend_network", false],
    ["resend_429:rate_limit_exceeded", false],
    ["resend_401:validation_error", false],
    // SMTP before DATA: DNS, connect, TLS, authentication, a timeout before the message.
    ["smtp_dns", true],
    ["smtp_edns", true],
    ["smtp_blocked_address", true],
    ["smtp_port_not_allowed", true],
    ["smtp_econnrefused", true],
    ["smtp_ehostunreach", true],
    ["smtp_econnection", true],
    ["smtp_etls", true],
    ["smtp_auth", true],
    ["smtp_timeout", true],
    // SMTP replies: an explicit refusal, whatever the command.
    ["smtp_421", true],
    ["smtp_550", true],
    ["smtp_554", true],
    ["smtp_250", false],
    // SMTP after DATA: the message may have been accepted.
    ["smtp_timeout_after_data", false],
    ["smtp_econnection_after_data", false],
    ["smtp_econnreset_after_data", false],
    ["smtp_error_after_data", false],
    // The stored credentials never reached a provider.
    ["seal_unreadable", true],
    ["invalid_provider", true],
    // Unknown or ambiguous: retry the same route.
    ["smtp_error", false],
    ["route_timeout", false],
    ["no_time", false],
    ["something_new", false],
  ])("%s → %s", (code, expected) => {
    expect(certainlyNotAccepted(code)).toBe(expected);
  });
});

describe("failureCode / resumeRoute", () => {
  it("writes the route the attempt stopped on in front of the code, capped at 120", () => {
    expect(failureCode("fallback", "smtp_timeout_after_data")).toBe(
      "fallback:smtp_timeout_after_data",
    );
    expect(failureCode("platform", "x".repeat(200))).toHaveLength(120);
  });

  it("an ambiguous failure resumes on its own route", () => {
    expect(resumeRoute("primary:smtp_timeout_after_data")).toBe("primary");
    expect(resumeRoute("fallback:route_timeout")).toBe("fallback");
    expect(resumeRoute("platform:resend_timeout")).toBe("platform");
  });

  it("a certain failure, no failure, or a code without a route starts from the first route", () => {
    expect(resumeRoute("platform:resend_500")).toBeNull();
    expect(resumeRoute(null)).toBeNull();
    expect(resumeRoute("db_error")).toBeNull();
    expect(resumeRoute("nowhere:smtp_timeout_after_data")).toBeNull();
  });
});
