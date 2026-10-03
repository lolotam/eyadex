import { expect, it } from "vitest";

import { redactSecrets, sanitize } from "../redaction.ts";

// Source payloads, job bodies and provider bodies never belong in technical diagnostics, and a phone number
// that travelled inside one of them is still a phone number.
it("drops source/job/provider payloads and embedded phones from diagnostics", () => {
  const value = {
    payload: { recipients: [{ phone: "+96500000001" }] },
    provider_body: "untrusted response",
    safe_parameters: [{ value: "synthetic-token" }],
    detail: "delivery to +96500000001 failed",
    phone_last3: "001",
    template_key: "synthetic_notice",
  };
  expect(sanitize(value)).toMatchObject({
    payload: "[REDACTED]",
    provider_body: "[REDACTED]",
    safe_parameters: "[REDACTED]",
    detail: "delivery to ***001 failed",
    phone_last3: "001",
  });
  expect(JSON.stringify(sanitize(value))).not.toContain("+96500000001");
  expect(redactSecrets({ phone: "+96500000001" })).toEqual({ phone: "+96500000001" });
});
