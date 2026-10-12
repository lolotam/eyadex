import { describe, expect, it } from "vitest";

import { ConfigurationError, errorDiagnostic } from "../index.ts";

// A failed start used to log only `{ type: "Error" }`, so the operator could not tell which Dokploy
// variable was missing (P2 follow-up). The names reach the log; a value never does.
describe("ConfigurationError in the log", () => {
  it("names the variables to fix", () => {
    const error = new ConfigurationError(
      "API",
      "MEDICAL_BLOB_S3_BUCKET, MEDICAL_BLOB_S3_SECRET_KEY must be set with the other MEDICAL_BLOB_S3_* variables",
    );
    expect(error.message).toMatch(
      /^Invalid API configuration: MEDICAL_BLOB_S3_BUCKET, .* — see \.env\.example$/,
    );
    expect(errorDiagnostic(error)).toEqual({
      type: "ConfigurationError",
      variables: ["MEDICAL_BLOB_S3_BUCKET", "MEDICAL_BLOB_S3_SECRET_KEY"],
    });
  });

  it("NEGATIVE: a value written into the detail by mistake never reaches the diagnostic", () => {
    const error = new ConfigurationError(
      "worker",
      "DATABASE_URL postgres://user:hunter2@db/x is wrong",
    );
    expect(JSON.stringify(errorDiagnostic(error))).not.toMatch(/hunter2|postgres/);
    expect(errorDiagnostic(error)).toEqual({
      type: "ConfigurationError",
      variables: ["DATABASE_URL"],
    });
  });

  it("NEGATIVE: a plain Error with the same message still logs no names", () => {
    expect(errorDiagnostic(new Error("Invalid API configuration: DATABASE_URL"))).toEqual({
      type: "Error",
    });
  });
});
