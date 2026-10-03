import { Writable } from "node:stream";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createLogger } from "@eyadex/observability";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp, watchShutdown } from "../../app.ts";
import { API_LOG_EVENTS } from "../log-events.ts";

let app: NestFastifyApplication | undefined;

// The log lines are swallowed here; the specs that read them build their own sink.
const silent = () => new Writable({ write: (_chunk, _encoding, done) => done() });

// Collects what the app writes, so a spec can assert on the lines themselves. `time` is dropped: it is
// pino's own, and no spec here depends on it.
const capture = () => {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split("\n").filter(Boolean)) {
        const { time: _time, ...rest } = JSON.parse(line) as Record<string, unknown>;
        lines.push(rest);
      }
      done();
    },
  });
  return { lines, logger: createLogger("info", { destination, events: API_LOG_EVENTS }) };
};

const start = async () => {
  app = await createApp(
    {},
    { logger: createLogger("info", { destination: silent(), events: API_LOG_EVENTS }) },
  );
  return app;
};

// NestFastifyApplication types close() with no argument; the signal is the same method's own argument, and
// what a SIGTERM delivers — this is exactly the call Nest makes when the signal arrives.
const closeWith = (target: NestFastifyApplication, signal: string) =>
  (target.close as (signal?: string) => Promise<void>)(signal);

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /v1/health", () => {
  it("answers 200 with the liveness status and nothing else — no version, no dependency", async () => {
    await start();
    const res = await app!.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    expect(res.body).not.toMatch(/version|node|nest/i);
  });

  it("is the only route outside a request id, and every route lives under /v1", async () => {
    await start();
    for (const url of ["/health", "/v1", "/", "/v1/health/extra"]) {
      const res = await app!.inject({ method: "GET", url });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: "not_found" });
    }
  });

  it("answers the same way for a method it does not serve", async () => {
    await start();
    const res = await app!.inject({ method: "DELETE", url: "/v1/health" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "not_found" });
  });
});

describe("shutdown", () => {
  it("releases what main.ts opened through the lifecycle hook when the app closes", async () => {
    let released = 0;
    app = await createApp(
      { onShutdown: async () => void (released += 1) },
      { logger: createLogger("info", { destination: silent() }) },
    );
    await app.close();
    app = undefined;
    expect(released).toBe(1);
  });

  it("logs one line when it starts, naming the signal, and one when the release finished", async () => {
    const { lines, logger } = capture();
    app = await createApp({ onShutdown: async () => undefined }, { logger });
    await closeWith(app, "SIGTERM");
    app = undefined;
    expect(lines).toEqual([
      { level: 30, signal: "SIGTERM", msg: "api shutdown started" },
      {
        level: 30,
        signal: "SIGTERM",
        ms: expect.any(Number) as unknown as number,
        msg: "api shutdown completed",
      },
    ]);
  });

  it("logs a failed release as failed, never as completed", async () => {
    const { lines, logger } = capture();
    const unclean: string[] = [];
    app = await createApp(
      {
        onShutdown: async () => Promise.reject(new Error("pool drain failed")),
        onUncleanShutdown: (signal) => void unclean.push(signal),
      },
      { logger },
    );
    await closeWith(app, "SIGTERM");
    expect(unclean).toEqual(["SIGTERM"]);
    app = undefined;
    expect(lines.map((line) => line["msg"])).toEqual([
      "api shutdown started",
      "api shutdown failed",
    ]);
    expect(lines[1]?.["level"]).toBe(50);
  });

  it("treats a release that throws before returning its promise as failed", async () => {
    const { lines, logger } = capture();
    const unclean: string[] = [];
    app = await createApp(
      {
        onShutdown: () => {
          throw new Error("sync release failure");
        },
        onUncleanShutdown: (signal) => void unclean.push(signal),
      },
      { logger },
    );
    await closeWith(app, "SIGTERM");
    app = undefined;
    expect(lines.map((line) => line["msg"])).toEqual([
      "api shutdown started",
      "api shutdown failed",
    ]);
    expect(unclean).toEqual(["SIGTERM"]);
  });

  it("logs a release that outlives its budget as timed out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { lines, logger } = capture();
      const unclean: string[] = [];
      app = await createApp(
        {
          onShutdown: () => new Promise<void>(() => undefined),
          onUncleanShutdown: (signal) => void unclean.push(signal),
        },
        { logger },
      );
      const closing = closeWith(app, "SIGTERM");
      await vi.advanceTimersByTimeAsync(10_000);
      await closing;
      expect(unclean).toEqual(["SIGTERM"]);
      app = undefined;
      expect(lines.map((line) => line["msg"])).toEqual([
        "api shutdown started",
        "api shutdown timed out",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the trigger when it closes without a signal", async () => {
    const { lines, logger } = capture();
    app = await createApp({}, { logger });
    await app.close();
    app = undefined;
    expect(lines.map((line) => line["msg"])).toEqual([
      "api shutdown started",
      "api shutdown completed",
    ]);
    expect(lines[0]?.["signal"]).toBe("app.close()");
  });

  it("leaves no placeholder line where framework startup text used to be", async () => {
    const { lines, logger } = capture();
    app = await createApp({}, { logger });
    await app.listen({ host: "127.0.0.1", port: 0 });
    expect(lines).toEqual([]);
    const res = await app!.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(lines.every((line) => line["msg"] !== "log message withheld")).toBe(true);
  });
});

describe("the shutdown watchdog", () => {
  it("exits non-zero when a shutdown that a signal started never finishes", async () => {
    vi.useFakeTimers();
    try {
      const { lines, logger } = capture();
      const signals: string[] = [];
      watchShutdown({
        logger,
        timeoutMs: 20_000,
        signals: ["SIGTERM"],
        onTimeout: (signal) => signals.push(signal),
      });
      process.emit("SIGTERM");
      await vi.advanceTimersByTimeAsync(19_999);
      expect(signals).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(signals).toEqual(["SIGTERM"]);
      expect(lines).toContainEqual(
        expect.objectContaining({ level: 60, signal: "SIGTERM", msg: "api shutdown timed out" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
