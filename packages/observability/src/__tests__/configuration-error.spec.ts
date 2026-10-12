import { describe, expect, it } from "vitest";

import { ConfigurationError, errorDiagnostic } from "../index.ts";

// A failed start used to log only `{ type: "Error" }`, so the operator could not tell which Dokploy
// variable was missing (P2 follow-up). The names reach the log; a value never does.
describe("ConfigurationError in the log", () => {
  it("names the variables to fix", () => {
    const error = new ConfigurationError(
      "API",
      ["MEDICAL_BLOB_S3_BUCKET", "MEDICAL_BLOB_S3_SECRET_KEY", "MEDICAL_BLOB_S3_BUCKET"],
      "must be set with the other MEDICAL_BLOB_S3_* variables",
    );
    expect(error.message).toMatch(
      /^Invalid API configuration: MEDICAL_BLOB_S3_BUCKET, .* — see \.env\.example$/,
    );
    expect(errorDiagnostic(error)).toEqual({
      type: "ConfigurationError",
      variables: ["MEDICAL_BLOB_S3_BUCKET", "MEDICAL_BLOB_S3_SECRET_KEY"],
    });
  });

  it("NEGATIVE: a variable-shaped value in the reason never reaches the diagnostic", () => {
    const error = new ConfigurationError(
      "worker",
      ["DATABASE_URL"],
      "has an invalid value: PRIVATE_VALUE_SHAPED_LIKE_A_VARIABLE",
    );
    expect(JSON.stringify(errorDiagnostic(error))).not.toContain(
      "PRIVATE_VALUE_SHAPED_LIKE_A_VARIABLE",
    );
    expect(errorDiagnostic(error)).toEqual({
      type: "ConfigurationError",
      variables: ["DATABASE_URL"],
    });
  });

  it("NEGATIVE: explicit names must match the entire variable shape", () => {
    const error = new ConfigurationError("API", [
      "DATABASE_URL",
      "DATABASE_URL\n",
      "prefix DATABASE_URL",
      "DATABASE_URL suffix",
      "lower_case",
      "UPPERCASE",
      "_KEY",
      "KEY_",
      "KEY__NAME",
    ]);
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
