import { describe, expect, it } from "vitest";

import { assertOptions } from "../options.ts";

const valid = {
  area: "clinic",
  databaseUrl: "postgres://eyadex_auth:change-me@localhost:5432/eyadex",
  secret: "x".repeat(32),
  baseUrl: "https://app.example.com",
};

describe("assertOptions", () => {
  it("accepts both areas", () => {
    expect(() => assertOptions(valid)).not.toThrow();
    expect(() => assertOptions({ ...valid, area: "platform" })).not.toThrow();
  });

  it("refuses an unknown area", () => {
    expect(() => assertOptions({ ...valid, area: "admin" })).toThrow(/area/);
  });

  it("refuses a short secret without echoing it", () => {
    const attempt = () => assertOptions({ ...valid, secret: "short-secret-value" });
    expect(attempt).toThrow(/secret/);
    expect(attempt).not.toThrow(/short-secret-value/);
  });

  it("refuses any database role other than eyadex_auth", () => {
    for (const role of ["eyadex_owner", "eyadex_app", "eyadex_platform"]) {
      const databaseUrl = `postgres://${role}:change-me@localhost:5432/eyadex`;
      expect(() => assertOptions({ ...valid, databaseUrl })).toThrow(/eyadex_auth/);
    }
  });

  it("refuses a relative or non-http base URL", () => {
    expect(() => assertOptions({ ...valid, baseUrl: "/clinic" })).toThrow(/baseUrl/);
    expect(() => assertOptions({ ...valid, baseUrl: "ftp://example.com" })).toThrow(/baseUrl/);
  });
});
