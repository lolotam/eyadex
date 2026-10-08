import { describe, expect, it } from "vitest";

import * as observability from "../index.ts";

describe("@eyadex/observability public surface", () => {
  it("offers createLogger as the only way to build a logger — no raw pino options", () => {
    expect(Object.keys(observability).sort()).toEqual([
      "BASE_LOG_EVENTS",
      "LOG_LEVELS",
      "REDACTED",
      "WITHHELD_MESSAGE",
      "createLogger",
      "enterRequestContext",
      "errorDiagnostic",
      "maskPhone",
      "maskPhonesInText",
      "normalizeAuditText",
      "redactSecrets",
      "requestContextFields",
      "requestDiagnostic",
      "responseDiagnostic",
      "sanitize",
      "scrubAuditText",
      "scrubAuditValue",
      "updateRequestContext",
      "withRequestContext",
    ]);
  });
});
