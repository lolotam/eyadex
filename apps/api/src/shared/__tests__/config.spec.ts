import { describe, expect, it } from "vitest";

import { readConfig } from "../config.ts";

describe("readConfig", () => {
  it("applies the defaults: every interface, port 3001, info level", () => {
    expect(readConfig({})).toEqual({ HOST: "0.0.0.0", PORT: 3001, LOG_LEVEL: "info" });
  });

  it("reads HOST, PORT and LOG_LEVEL from the environment", () => {
    expect(readConfig({ HOST: "127.0.0.1", PORT: "8080", LOG_LEVEL: "debug" })).toEqual({
      HOST: "127.0.0.1",
      PORT: 8080,
      LOG_LEVEL: "debug",
    });
  });

  it("refuses a port that is not a number in range", () => {
    expect(() => readConfig({ PORT: "0" })).toThrow(/PORT/);
    expect(() => readConfig({ PORT: "70000" })).toThrow(/PORT/);
    expect(() => readConfig({ PORT: "not-a-port" })).toThrow(/PORT/);
  });

  it("refuses a log level pino does not know", () => {
    expect(() => readConfig({ LOG_LEVEL: "hunter2secret" })).toThrow(/LOG_LEVEL/);
  });

  it("names the offending keys but never echoes a value", () => {
    const attempt = () => readConfig({ HOST: "", PORT: "not-a-port" });
    expect(attempt).toThrow(/HOST/);
    expect(attempt).toThrow(/PORT/);
    try {
      attempt();
    } catch (error) {
      expect(String(error)).not.toContain("not-a-port");
    }
  });

  it("rejects an empty HOST, so a missing interface is never silently the default", () => {
    expect(() => readConfig({ HOST: "" })).toThrow(/HOST/);
  });
});
