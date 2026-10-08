import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { readConfig } from "../config.ts";

// Dev-shaped values only: no real key, no real host.
const required = {
  DATABASE_URL: "postgres://eyadex_app:dev@localhost:5432/eyadex",
  DISPATCHER_DATABASE_URL: "postgres://eyadex_dispatcher:dev@localhost:5432/eyadex",
  PLATFORM_DATABASE_URL: "postgres://eyadex_platform:dev@localhost:5432/eyadex",
  PLATFORM_URL: "http://platform.localhost:3000/",
  OUTBOX_SEAL_KEY: randomBytes(32).toString("base64"),
  MAIL_PROVIDER_SEAL_KEY: randomBytes(32).toString("base64"),
  APP_URL: "http://localhost:3000/",
  RESEND_API_KEY: "test-only",
  MAIL_FROM: "Eyadex Team <no-reply@example.test>",
};

describe("readConfig", () => {
  it("applies the defaults: every interface, port 3002 (the API owns 3001), info level, 2 s poll", () => {
    expect(readConfig(required)).toMatchObject({
      WORKER_HOST: "0.0.0.0",
      WORKER_PORT: 3002,
      LOG_LEVEL: "info",
      OUTBOX_POLL_INTERVAL_MS: 2000,
      APP_URL: "http://localhost:3000",
      PLATFORM_URL: "http://platform.localhost:3000",
      EXPIRY_SCAN_INTERVAL_MS: 3_600_000,
    });
  });

  it("needs the platform pool and origin for the expiry scan and team invitations (ADR-0020)", () => {
    const { PLATFORM_DATABASE_URL: _p, PLATFORM_URL: _u, ...without } = required;
    const attempt = () => readConfig(without);
    expect(attempt).toThrow(/PLATFORM_DATABASE_URL/);
    expect(attempt).toThrow(/PLATFORM_URL/);
    expect(() => readConfig({ ...required, EXPIRY_SCAN_INTERVAL_MS: "1000" })).toThrow(
      /EXPIRY_SCAN_INTERVAL_MS/,
    );
  });

  it("reads the interface, the port and the level from the environment", () => {
    expect(
      readConfig({ ...required, WORKER_HOST: "127.0.0.1", WORKER_PORT: "3009", LOG_LEVEL: "warn" }),
    ).toMatchObject({ WORKER_HOST: "127.0.0.1", WORKER_PORT: 3009, LOG_LEVEL: "warn" });
  });

  it("fails at boot when a mail or database setting is missing, naming the keys only", () => {
    const attempt = () =>
      readConfig({ ...required, RESEND_API_KEY: "", OUTBOX_SEAL_KEY: "c2hvcnQ=" });
    expect(attempt).toThrow(/RESEND_API_KEY/);
    expect(attempt).toThrow(/OUTBOX_SEAL_KEY/);
    expect(() => readConfig({})).toThrow(/DISPATCHER_DATABASE_URL/);
  });

  it("requires MAIL_PROVIDER_SEAL_KEY as 32 base64 bytes, naming the key only", () => {
    const { MAIL_PROVIDER_SEAL_KEY: _k, ...without } = required;
    expect(() => readConfig(without)).toThrow(/MAIL_PROVIDER_SEAL_KEY/);
    expect(() => readConfig({ ...required, MAIL_PROVIDER_SEAL_KEY: "c2hvcnQ=" })).toThrow(
      /MAIL_PROVIDER_SEAL_KEY/,
    );
  });

  it("refuses a port out of range and a level pino does not know, naming the keys only", () => {
    const attempt = () =>
      readConfig({ ...required, WORKER_PORT: "70000", LOG_LEVEL: "hunter2secret" });
    expect(attempt).toThrow(/WORKER_PORT/);
    expect(attempt).toThrow(/LOG_LEVEL/);
    try {
      attempt();
    } catch (error) {
      expect(String(error)).not.toContain("hunter2secret");
    }
  });
});

describe("readConfig SMTP fallback (ADR-0014)", () => {
  const smtp = {
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_USER: "mailer",
    SMTP_PASSWORD: "test-only-value",
  };

  it("all four keys → fallback configured", () => {
    expect(readConfig({ ...required, ...smtp }).SMTP).toEqual({
      host: "smtp.example.test",
      port: 587,
      user: "mailer",
      password: "test-only-value",
    });
  });

  it("none (or all empty) → no fallback", () => {
    expect(readConfig(required).SMTP).toBeNull();
    expect(
      readConfig({ ...required, SMTP_HOST: "", SMTP_PORT: "", SMTP_USER: "", SMTP_PASSWORD: "" })
        .SMTP,
    ).toBeNull();
  });

  it("a partial set stops startup, naming only the missing keys", () => {
    const attempt = () =>
      readConfig({ ...required, SMTP_HOST: smtp.SMTP_HOST, SMTP_PASSWORD: smtp.SMTP_PASSWORD });
    expect(attempt).toThrow(/SMTP_PORT, SMTP_USER/);
    try {
      attempt();
    } catch (error) {
      expect(String(error)).not.toContain("test-only-value");
      expect(String(error)).not.toContain("smtp.example.test");
    }
  });
});
