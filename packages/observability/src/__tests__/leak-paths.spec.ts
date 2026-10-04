import { Writable } from "node:stream";

import type { Logger } from "pino";
import { describe, expect, it } from "vitest";

import { createLogger } from "../logger.ts";

// Every way a value can reach a pino line other than a plain logged key. Each case checks the final
// written line, not an intermediate object.
const capture = (log: (logger: Logger) => void): string => {
  let written = "";
  const sink = new Writable({
    write(chunk, _encoding, done) {
      written += String(chunk);
      done();
    },
  });
  log(
    createLogger("info", {
      destination: sink,
      events: [
        "probe",
        "boom",
        "x",
        "event",
        "grandchild",
        "child",
        "sibling",
        "root",
        "after setBindings",
        "incoming request",
        "api failed to start",
      ],
    }),
  );
  return written;
};

const SECRET = "tok_live_leak";

describe("the message field", () => {
  it("an Error logged on its own does not put its message into msg", () => {
    const line = capture((log) => log.error(new Error(`failed: token=${SECRET}`)));
    expect(line).not.toContain(SECRET);
    expect(JSON.parse(line)).toMatchObject({ msg: "error", err: { type: "Error" } });
  });

  it("an { err } logged without a message does not put the error message into msg", () => {
    const line = capture((log) => log.error({ err: new Error(`token=${SECRET}`) }));
    expect(line).not.toContain(SECRET);
  });

  it("printf-style arguments are dropped, never interpolated into msg", () => {
    const line = capture((log) => log.info("user signed in with %s", SECRET));
    expect(line).not.toContain(SECRET);
  });
});

describe("child logger bindings", () => {
  it("bindings on a child, a grandchild and setBindings are sanitised", () => {
    const line = capture((log) => {
      const child = log.child({ token: SECRET, phone: "96550012345" });
      child.child({ nested: { apiKey: SECRET } }).info("event");
      child.setBindings({ password: SECRET });
      child.info("after setBindings");
    });
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain("96550012345");
    expect(line).toContain("***345");
  });
});

describe("error text posing as structure", () => {
  it("a multiline message cannot pose as a stack frame", () => {
    const line = capture((log) =>
      log.error({ err: new Error(`failure\n    at token=${SECRET}`) }, "x"),
    );
    expect(line).not.toContain(SECRET);
  });

  it("a name or code outside the allowlist is dropped, not printed", () => {
    const error = Object.assign(new Error("x"), { code: `code ${SECRET}` });
    error.name = `Name${SECRET}`;
    const line = capture((log) => log.error({ err: error }, "x"));
    expect(line).not.toContain(SECRET);
    expect(JSON.parse(line)).toMatchObject({ err: { type: "Error" } });
  });
});

describe("executable data", () => {
  it("a toJSON hook is dropped, so JSON serialisation cannot call it", () => {
    const line = capture((log) =>
      log.info({ record: { safe: 1, toJSON: () => ({ token: SECRET }) } }, "probe"),
    );
    expect(line).not.toContain(SECRET);
    expect(JSON.parse(line)).toMatchObject({ record: { safe: 1 } });
  });

  it("dates become ISO strings and bigints strings", () => {
    const line = capture((log) =>
      log.info({ at: new Date("2026-10-03T00:00:00Z"), mills: 12_500n }, "probe"),
    );
    expect(JSON.parse(line)).toMatchObject({ at: "2026-10-03T00:00:00.000Z", mills: "12500" });
  });
});

describe("values that satisfied the earlier rules", () => {
  it("a thrown string or plain object under err is reduced to a fixed label", () => {
    const line = capture((log) => {
      log.error({ err: `token=${SECRET}` }, "x");
      log.error({ err: { message: `token=${SECRET}` } }, "x");
    });
    expect(line).not.toContain(SECRET);
    expect(line).toContain('"type":"NonError"');
  });

  it("a PIN-shaped code or a crafted name is never printed", () => {
    const error = Object.assign(new Error("x"), { code: "482193" });
    error.name = "LeakyTokError";
    const line = capture((log) => log.error({ err: error }, "x"));
    expect(line).not.toContain("482193");
    expect(line).not.toContain("LeakyTok");
  });

  it("a stale cached stack cannot smuggle a fake frame", () => {
    const error = new Error(`failure\n    at token=${SECRET}`);
    void error.stack;
    error.message = "failure";
    expect(capture((log) => log.error({ err: error }, "x"))).not.toContain(SECRET);
  });

  it("a message carrying data is withheld — interpolated text, an error message, a digit run", () => {
    const error = new Error(`token=${SECRET}`);
    const line = capture((log) => {
      log.info(`token=${SECRET}`);
      log.error(error, error.message);
      log.info("patient 96550012345 registered");
    });
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain("96550012345");
    expect(line.match(/log message withheld/g)).toHaveLength(3);
  });

  it("a constant event name is kept", () => {
    expect(JSON.parse(capture((log) => log.info("api failed to start")))).toMatchObject({
      msg: "api failed to start",
    });
  });
});

describe("binding ownership", () => {
  it("a grandchild inherits its parents; setBindings changes only its own logger", () => {
    const lines = capture((log) => {
      const child = log.child({ requestId: "r1" });
      const sibling = log.child({ requestId: "r2" });
      child.child({ step: "inner" }).info("grandchild");
      child.setBindings({ requestId: "r1-updated" });
      child.info("child");
      sibling.info("sibling");
      log.info("root");
    })
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({ requestId: "r1", step: "inner", msg: "grandchild" });
    expect(lines[1]).toMatchObject({ requestId: "r1-updated", msg: "child" });
    expect(lines[2]).toMatchObject({ requestId: "r2", msg: "sibling" });
    expect(lines[3]).not.toHaveProperty("requestId");
  });
});

describe("finite allowlists, no stack text", () => {
  it("a message line shaped exactly like a frame is not logged — stacks are never printed", () => {
    const line = capture((log) =>
      log.error({ err: new Error("failure\n    at /tok_test_secret:1:1") }, "x"),
    );
    expect(line).not.toContain("tok_test_secret");
    expect(JSON.parse(line).err).not.toHaveProperty("frames");
  });

  it("only listed codes are printed — look-alikes of the accepted shapes are dropped", () => {
    const line = capture((log) => {
      log.error({ err: Object.assign(new Error("x"), { code: "ESECRET" }) }, "x");
      log.error({ err: Object.assign(new Error("x"), { code: "FST_ERR_SECRET_TOKEN" }) }, "x");
      log.error({ err: Object.assign(new Error("x"), { code: "ECONNREFUSED" }) }, "x");
    });
    expect(line).not.toContain("ESECRET");
    expect(line).not.toContain("FST_ERR_SECRET_TOKEN");
    expect(line).toContain('"code":"ECONNREFUSED"');
  });

  it("a message that is not a catalogued event is withheld, whatever it looks like", () => {
    const error = new Error("4821");
    const line = capture((log) => {
      log.error(error, error.message);
      log.info("tok_live_leak");
      log.info("965 5001 2345");
    });
    for (const leak of ["4821", "tok_live_leak", "5001"]) expect(line).not.toContain(leak);
  });
});

describe("reserved keys and binding reduction", () => {
  it("a msg field inside the logged object never reaches the raw output", () => {
    const raw = capture((log) => {
      log.info({ msg: SECRET });
      log.info({ msg: SECRET, level: SECRET }, "probe");
    });
    expect(raw).not.toContain(SECRET);
  });

  it("bindings get the same reduction as log objects — err, req and msg included", () => {
    const raw = capture((log) => {
      const child = log.child({
        err: `token=${SECRET}`,
        req: { method: "GET", url: `/reset/${SECRET}` },
        msg: SECRET,
      });
      child.info("event");
      child.setBindings({ err: { message: SECRET } });
      child.info("event");
    });
    expect(raw).not.toContain(SECRET);
    expect(raw).toContain('"type":"NonError"');
  });
});

describe("child options and key spellings", () => {
  it("child options are not forwarded — a msgPrefix cannot reach the output", () => {
    const raw = capture((log) => log.child({}, { msgPrefix: `${SECRET} ` } as never).info("event"));
    expect(raw).not.toContain(SECRET);
  });

  it.each([
    "access_token",
    "refresh-token",
    "client_secret",
    "X-Api-Key",
    "sessionToken",
    "otp",
    "card_cvv",
  ])("the key %s is redacted", (key) => {
    expect(capture((log) => log.info({ [key]: SECRET }, "event"))).not.toContain(SECRET);
  });

  it("an ordinary key that merely contains a secret word is kept (openingHours, reason)", () => {
    const line = JSON.parse(
      capture((log) => log.info({ openingHours: "late", reason: "SETUP_FAILED" }, "event")),
    );
    expect(line).toMatchObject({ openingHours: "late", reason: "SETUP_FAILED" });
  });
});
