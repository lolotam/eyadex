import { Writable } from "node:stream";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { systemUuidV7 } from "@eyadex/ids";
import { createLogger } from "@eyadex/observability";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../app.ts";
import { API_LOG_EVENTS } from "../log-events.ts";

// UUID v7, as @eyadex/ids produces it.
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INCOMING = "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b";

const lines: Record<string, unknown>[] = [];
// The text of every line: a JSON object cannot hold the same key twice, so only the raw text shows whether
// the id was printed once or twice.
const rawLines: string[] = [];
let app: NestFastifyApplication;

beforeAll(async () => {
  const destination = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split("\n").filter(Boolean)) {
        rawLines.push(line);
        lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      done();
    },
  });
  app = await createApp(
    { ids: systemUuidV7() },
    { logger: createLogger("info", { destination, events: API_LOG_EVENTS }) },
  );
});

afterAll(async () => {
  await app.close();
});

const get = async (headers?: Record<string, string>) => {
  const res = await app.inject({
    method: "GET",
    url: "/v1/health",
    ...(headers === undefined ? {} : { headers }),
  });
  return { id: String(res.headers["x-request-id"]), body: res.json() };
};

const completedLines = () => lines.filter((line) => line["msg"] === "request completed");

describe("a request without an id", () => {
  it("gets a UUID v7 from @eyadex/ids, echoed in the response header", async () => {
    const res = await get();
    expect(res.body).toEqual({ status: "ok" });
    expect(res.id).toMatch(UUID_V7);
  });

  it("gets a different one every time", async () => {
    const ids = new Set([(await get()).id, (await get()).id, (await get()).id]);
    expect(ids.size).toBe(3);
  });

  it("carries it on the request's own completion line", async () => {
    const res = await get();
    const line = completedLines().find((entry) => entry["request_id"] === res.id);
    expect(line).toMatchObject({ http: { method: "GET", route: "/v1/health", status: 200 } });
  });

  it("prints it once, under one name — Fastify's own reqId label is not on the line", async () => {
    const res = await get();
    const raw = rawLines.find((line) => line.includes(`"${res.id}"`)) ?? "";
    expect(raw).toContain(`"request_id":"${res.id}"`);
    expect(raw).not.toContain("reqId");
    // Once, not twice: the request context and Fastify's binding both carry it, and only one may print it.
    expect(raw.match(/"request_id":/g)).toHaveLength(1);
  });
});

describe("a request that brings its own id", () => {
  it("is kept when it is a UUID, so a trace spans the web app and the API", async () => {
    const res = await get({ "x-request-id": INCOMING });
    expect(res.id).toBe(INCOMING);
    expect(completedLines().some((line) => line["request_id"] === INCOMING)).toBe(true);
  });

  it.each([
    ["too short", "short"],
    ["with a space", "not a token"],
    ["too long", "x".repeat(129)],
    ["not a token character", "edge-request-0001#fragment"],
    ["an opaque token that may be a credential", "ghp_16C7e42F292c6912E7710c838347Ae178B4a"],
    ["a plain token", "edge-request-0001"],
    ["a UUID with trailing text", "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b-x"],
  ])("is replaced when it is %s", async (_label, given) => {
    const res = await get({ "x-request-id": given });
    expect(res.id).toMatch(UUID_V7);
    expect(res.id).not.toBe(given);
  });
});

describe("a request the router rejects", () => {
  it("still gets an id, echoed in the response and on its completion line", async () => {
    const res = await app.inject({ method: "GET", url: "/%ZZ" });
    expect(res.statusCode).toBe(400);
    const id = String(res.headers["x-request-id"]);
    expect(id).toMatch(UUID_V7);
    expect(completedLines().some((line) => line["request_id"] === id)).toBe(true);
  });
});

describe("the raw URL", () => {
  it("never reaches the log lines — only the route pattern", async () => {
    lines.length = 0;
    rawLines.length = 0;
    await app.inject({ method: "GET", url: "/v1/health?token=synthetic_query_secret" });
    const line = completedLines().at(0);
    expect(line).toMatchObject({ http: { route: "/v1/health" } });
    expect(JSON.stringify(lines)).not.toContain("synthetic_query_secret");
  });
});
