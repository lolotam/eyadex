import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createLogger } from "../logger.ts";
import { enterRequestContext, updateRequestContext } from "../request-context.ts";

// Every line of a request carries request_id, clinic_id, branch_id and user_id — and a PIN logged by
// mistake, in a field or in the message, never reaches the output (CLAUDE.md §8).
const REQUEST = "01920000-0000-7000-8000-00000000a001";
const CLINIC = "01920000-0000-7000-8000-00000000c001";
const BRANCH = "01920000-0000-7000-8000-00000000b001";
const USER = "01920000-0000-7000-8000-00000000d001";

function capture() {
  const lines: Record<string, unknown>[] = [];
  let raw = "";
  const destination = new Writable({
    write(chunk, _encoding, done) {
      raw += String(chunk);
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      done();
    },
  });
  return {
    logger: createLogger("info", { destination, events: ["pin checked"] }),
    lines,
    raw: () => raw,
  };
}

describe("request context on every line", () => {
  it("carries request_id from the start, and clinic, branch and user once they are verified", async () => {
    const { logger, lines } = capture();
    await new Promise<void>((done) => {
      setImmediate(() => {
        enterRequestContext(REQUEST);
        logger.info("log");
        updateRequestContext({ clinicId: CLINIC, branchId: BRANCH, userId: USER });
        setImmediate(() => {
          logger.info("log");
          done();
        });
      });
    });
    expect(lines[0]).toMatchObject({ request_id: REQUEST });
    expect(lines[0]).not.toHaveProperty("clinic_id");
    expect(lines[1]).toMatchObject({
      request_id: REQUEST,
      clinic_id: CLINIC,
      branch_id: BRANCH,
      user_id: USER,
    });
  });

  it("adds nothing outside a request", () => {
    const { logger, lines } = capture();
    logger.info("log");
    expect(lines[0]).not.toHaveProperty("request_id");
  });

  it("is printed once on a logger that already carries the id in a binding", async () => {
    const { logger, raw } = capture();
    // Fastify labels the request id it puts on its per-request child logger `request_id`; the same value
    // arrives through the request context too, and only one of the two may reach the line.
    const request = logger.child({ request_id: REQUEST });
    await new Promise<void>((done) => {
      setImmediate(() => {
        enterRequestContext(REQUEST);
        request.info("log");
        done();
      });
    });
    expect(raw().match(/"request_id":/g)).toHaveLength(1);
    expect(raw()).toContain(REQUEST);
  });
});

describe("a PIN logged by mistake", () => {
  it("never appears in the output — not in a field, a nested field, nor the message", async () => {
    const { logger, raw } = capture();
    await new Promise<void>((done) => {
      setImmediate(() => {
        enterRequestContext(REQUEST);
        logger.info({ pin: "4821", session: { pin_code: "4821" } }, "pin checked");
        logger.info({ note: "x" }, "PIN 4821 entered");
        done();
      });
    });
    expect(raw()).not.toContain("4821");
    expect(raw()).toContain(REQUEST);
  });
});
