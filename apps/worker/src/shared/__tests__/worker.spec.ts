import { Writable } from "node:stream";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createLogger, type Logger } from "@eyadex/observability";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WORKER_LOG_EVENTS } from "../log-events.ts";
import { createWorker, watchShutdown } from "../../worker.ts";

let worker: NestFastifyApplication | undefined;

// Collects what the worker writes, so a spec can assert on the lines themselves. `time` is dropped: it is
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
  return { lines, logger: createLogger("info", { destination, events: WORKER_LOG_EVENTS }) };
};

// The specs that assert nothing about the lines write them nowhere.
const silent = () =>
  createLogger("info", {
    destination: new Writable({ write: (_chunk, _encoding, done) => done() }),
    events: WORKER_LOG_EVENTS,
  });

const start = async (release?: () => Promise<void>, logger: Logger = silent()) => {
  worker = await createWorker(release === undefined ? {} : { release }, logger);
  return worker;
};

const stop = async () => {
  await worker?.close();
  worker = undefined;
};

// NestFastifyApplication types close() with no argument; the signal is the same method's own argument, and
// what a SIGTERM delivers — exactly the call Nest makes when the signal arrives.
const closeWith = (target: NestFastifyApplication, signal: string) =>
  (target.close as (signal?: string) => Promise<void>)(signal);

// The shutdown lines on their own, so a spec asserts them without the boot noise.
const shutdownLines = (lines: Record<string, unknown>[]) =>
  lines.filter((line) => String(line["msg"]).startsWith("worker shutdown"));

afterEach(stop);

describe("the worker process", () => {
  it("boots and answers its liveness route without touching anything", async () => {
    await start();
    const res = await worker!.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("listens on a real port and answers over HTTP, the way main.ts starts it", async () => {
    const { lines, logger } = capture();
    await start(undefined, logger);
    await worker!.listen({ host: "127.0.0.1", port: 0 });
    const address = worker!.getHttpServer().address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    // Fastify announces every address it bound as free text, which is not a catalogued event: nothing of it
    // reaches the log, so the line that says the worker is up stays main.ts's alone.
    expect(lines).toEqual([]);
  });

  it("releases through the lifecycle hook when it shuts down", async () => {
    let released = 0;
    await start(async () => void (released += 1));
    await stop();
    expect(released).toBe(1);
  });

  it("answers 404 for anything else, so no job endpoint exists by accident", async () => {
    await start();
    const res = await worker!.inject({ method: "GET", url: "/jobs" });
    expect(res.statusCode).toBe(404);
  });
});

describe("worker shutdown", () => {
  it("logs one line when it starts, naming the signal, and one when the release finished", async () => {
    const { lines, logger } = capture();
    await start(undefined, logger);
    await closeWith(worker!, "SIGTERM");
    worker = undefined;
    expect(shutdownLines(lines)).toEqual([
      { level: 30, signal: "SIGTERM", msg: "worker shutdown started" },
      {
        level: 30,
        signal: "SIGTERM",
        ms: expect.any(Number) as unknown as number,
        msg: "worker shutdown completed",
      },
    ]);
  });

  it("logs a failed release as failed, never as completed", async () => {
    const { lines, logger } = capture();
    const unclean: string[] = [];
    worker = await createWorker(
      {
        release: async () => Promise.reject(new Error("queue drain failed")),
        onUncleanShutdown: (signal) => void unclean.push(signal),
      },
      logger,
    );
    await closeWith(worker, "SIGTERM");
    expect(unclean).toEqual(["SIGTERM"]);
    worker = undefined;
    expect(shutdownLines(lines).map((line) => line["msg"])).toEqual([
      "worker shutdown started",
      "worker shutdown failed",
    ]);
  });

  it("treats a release that throws before returning its promise as failed", async () => {
    const { lines, logger } = capture();
    const unclean: string[] = [];
    worker = await createWorker(
      {
        release: () => {
          throw new Error("sync release failure");
        },
        onUncleanShutdown: (signal) => void unclean.push(signal),
      },
      logger,
    );
    await closeWith(worker, "SIGTERM");
    worker = undefined;
    expect(shutdownLines(lines).map((line) => line["msg"])).toEqual([
      "worker shutdown started",
      "worker shutdown failed",
    ]);
    expect(unclean).toEqual(["SIGTERM"]);
  });

  it("names the trigger when it closes without a signal", async () => {
    const { lines, logger } = capture();
    await start(undefined, logger);
    await stop();
    expect(shutdownLines(lines).map((line) => line["signal"])).toEqual([
      "app.close()",
      "app.close()",
    ]);
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
        timeoutMs: 45_000,
        signals: ["SIGTERM"],
        onTimeout: (signal) => signals.push(signal),
      });
      process.emit("SIGTERM");
      await vi.advanceTimersByTimeAsync(44_999);
      expect(signals).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(signals).toEqual(["SIGTERM"]);
      expect(shutdownLines(lines)).toContainEqual({
        level: 60,
        signal: "SIGTERM",
        msg: "worker shutdown timed out",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
