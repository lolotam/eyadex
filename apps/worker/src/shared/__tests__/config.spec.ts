import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { readConfig } from "../config.ts";

// Dev-shaped values only: no real key, no real host.
const required = {
  DATABASE_URL: "postgres://eyadex_app:dev@localhost:5432/eyadex",
  DISPATCHER_DATABASE_URL: "postgres://eyadex_dispatcher:dev@localhost:5432/eyadex",
  OUTBOX_SEAL_KEY: randomBytes(32).toString("base64"),
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
    });
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
