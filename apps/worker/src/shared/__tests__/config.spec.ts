import { describe, expect, it } from "vitest";

import { readConfig } from "../config.ts";

describe("readConfig", () => {
  it("applies the defaults: every interface, port 3002 (the API owns 3001), info level", () => {
    expect(readConfig({})).toEqual({
      WORKER_HOST: "0.0.0.0",
      WORKER_PORT: 3002,
      LOG_LEVEL: "info",
    });
  });

  it("reads the interface, the port and the level from the environment", () => {
    expect(
      readConfig({ WORKER_HOST: "127.0.0.1", WORKER_PORT: "3009", LOG_LEVEL: "warn" }),
    ).toEqual({ WORKER_HOST: "127.0.0.1", WORKER_PORT: 3009, LOG_LEVEL: "warn" });
  });

  it("refuses a port out of range and a level pino does not know, naming the keys only", () => {
    const attempt = () => readConfig({ WORKER_PORT: "70000", LOG_LEVEL: "hunter2secret" });
    expect(attempt).toThrow(/WORKER_PORT/);
    expect(attempt).toThrow(/LOG_LEVEL/);
    try {
      attempt();
    } catch (error) {
      expect(String(error)).not.toContain("hunter2secret");
    }
  });
});
