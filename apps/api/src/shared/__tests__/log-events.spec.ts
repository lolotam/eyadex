import { Writable } from "node:stream";

import { createLogger } from "@eyadex/observability";
import { describe, expect, it } from "vitest";

import { API_LOG_EVENTS } from "../log-events.ts";

// Messages the auth handler logs on its own failure paths (it sits outside Nest's exception filter).
// A message missing from the catalogue is replaced by "log message withheld" and the outage it reports
// cannot be told apart from any other failure.
const AUTH_HANDLER_EVENTS = ["rate limiter unavailable", "unhandled error"] as const;

describe("API log catalogue", () => {
  for (const event of AUTH_HANDLER_EVENTS) {
    it(`keeps "${event}" readable`, () => {
      const lines: { msg?: unknown }[] = [];
      const destination = new Writable({
        write: (chunk: Buffer, _encoding, done) => {
          lines.push(JSON.parse(chunk.toString()) as { msg?: unknown });
          done();
        },
      });
      const logger = createLogger("info", { destination, events: API_LOG_EVENTS });
      logger.error({ err: new Error("connect ECONNREFUSED") }, event);
      expect(lines.at(-1)?.msg).toBe(event);
    });
  }
});
