import { Writable } from "node:stream";

import type { Logger } from "pino";
import { describe, expect, it } from "vitest";

import { createLogger } from "../logger.ts";
import { REDACTED, redactSecrets, sanitize } from "../redaction.ts";

// Logs through the real pino config and returns exactly what pino wrote.
const capture = (log: (logger: Logger) => void): string => {
  let written = "";
  const sink = new Writable({
    write(chunk, _encoding, done) {
      written += String(chunk);
      done();
    },
  });
  log(createLogger("info", { destination: sink, events: ["probe", "boom", "incoming request"] }));
  return written;
};

const logLine = (entry: Record<string, unknown>): string =>
  capture((logger) => logger.info(entry, "probe"));

const SECRETS = ["4821", "hunter2hunter2", "tok_live_abcdef", "key_live_123", "rt_xyz"];

it("email addresses and operational bodies never enter diagnostics at any depth", () => {
  const email = "synthetic.owner@example.invalid";
  const line = logLine({
    recipientEmail: email,
    nested: [{ EMAIL_ADDRESS: email }],
    note: `Delivery failed for ${email}`,
    emailHtml: "private email body",
    emailText: "private email body",
    providerBody: { to: email },
    rawBody: "private email body",
  });
  expect(line).not.toContain(email);
  expect(line).not.toContain("private email body");
});

describe("secrets are removed at any depth (CLAUDE.md §8)", () => {
  it("top level, nested three levels deep, and inside arrays", () => {
    const line = logLine({
      pin: "4821",
      data: { user: { profile: { password: "hunter2hunter2", token: "tok_live_abcdef" } } },
      batch: [{ apiKey: "key_live_123" }, { nested: [{ refreshToken: "rt_xyz" }] }],
    });
    for (const secret of SECRETS) expect(line).not.toContain(secret);
    expect(line).toContain("[REDACTED]");
  });

  it("whatever the key casing", () => {
    const line = logLine({
      Authorization: "Bearer abc.def",
      TOKEN: "tok_live_abcdef",
      Cookie: "sid=1",
    });
    for (const secret of ["abc.def", "tok_live_abcdef", "sid=1"])
      expect(line).not.toContain(secret);
  });

  it("keeps only the last 3 digits of a phone number, even deep inside an array", () => {
    const line = logLine({
      phone: "+965 5001 2345",
      rows: [{ clinic: { mobile: "96550067890" } }],
    });
    expect(line).not.toContain("50012345");
    expect(line).not.toContain("5006789");
    expect(JSON.parse(line)).toMatchObject({
      phone: "***345",
      rows: [{ clinic: { mobile: "***890" } }],
    });
  });

  it("survives a circular object instead of hanging or throwing", () => {
    const loop: Record<string, unknown> = { label: "loop" };
    loop["self"] = loop;
    expect(JSON.parse(logLine({ loop }))).toMatchObject({
      loop: { label: "loop", self: "[Circular]" },
    });
  });

  it("still prints ordinary fields, including a clinic and a branch name (a clinic is not a patient)", () => {
    // The bare `name` rule redacts patient identity; the structural exemption keeps the business-entity
    // spellings printable, so a log line can still say which clinic and branch it came from.
    expect(
      JSON.parse(
        logLine({ clinicLabel: "Clinic One", clinicName: "Clinic One", branchName: "Salmiya" }),
      ),
    ).toMatchObject({
      clinicLabel: "Clinic One",
      clinicName: "Clinic One",
      branchName: "Salmiya",
      msg: "probe",
    });
  });
});

describe("errors are logged as type, code and frames — never the message or causes", () => {
  it("a secret in an error message, its cause, or an extra property never reaches the output", () => {
    const cause = new Error("upstream said token=tok_live_abcdef");
    const error = Object.assign(
      new Error("sign-in failed for 96550012345 with pin 4821", { cause }),
      {
        code: "28P01",
        query: "SELECT * FROM users WHERE password = hunter2hunter2",
      },
    );
    const line = capture((logger) => logger.error({ err: error }, "boom"));
    for (const secret of ["tok_live_abcdef", "96550012345", "4821", "hunter2hunter2", "SELECT"]) {
      expect(line).not.toContain(secret);
    }
    // '28P01' is outside the code allowlist (only E… and FST_ERR_… shapes are printed), so it is dropped too.
    expect(JSON.parse(line)).toMatchObject({ err: { type: "Error" } });
    expect(JSON.parse(line).err).not.toHaveProperty("code");
  });
});

describe("requests are logged as method and route pattern — never the raw URL", () => {
  it("a token or a phone in the path or query string never reaches the output", () => {
    const request = {
      method: "GET",
      id: "req-1",
      url: "/v1/reset/tok_live_abcdef?phone=96550012345",
      routeOptions: { url: "/v1/reset/:token" },
      headers: { authorization: "Bearer abc.def" },
    };
    const line = capture((logger) => logger.info({ req: request }, "incoming request"));
    for (const secret of ["tok_live_abcdef", "96550012345", "abc.def"]) {
      expect(line).not.toContain(secret);
    }
    expect(JSON.parse(line)).toMatchObject({ req: { method: "GET", route: "/v1/reset/:token" } });
  });
});

describe("redactSecrets — for kept business records", () => {
  it("replaces secrets at any depth but keeps phone numbers whole", () => {
    expect(
      redactSecrets({ pinHash: "h", device: { token: "t" }, phone: "96550012345", name: "Main" }),
    ).toEqual({
      pinHash: REDACTED,
      device: { token: REDACTED },
      phone: "96550012345",
      name: "Main",
    });
  });
});

describe("code-named secrets", () => {
  it("redacts a PIN, OTP or pass code under a *_code key, but keeps error and status codes", () => {
    const redacted = redactSecrets({
      pin_code: "4821",
      passCode: "4821",
      otp_code: "4821",
      security_code: "4821",
      verificationCode: "4821",
      error_code: "E42",
      status_code: 201,
    });
    expect(redacted).toEqual({
      pin_code: REDACTED,
      passCode: REDACTED,
      otp_code: REDACTED,
      security_code: REDACTED,
      verificationCode: REDACTED,
      error_code: "E42",
      status_code: 201,
    });
  });
});

describe("the project's own field names", () => {
  it("pin_hash, token_hash and password_hash are redacted", () => {
    const raw = capture((log) =>
      log.info(
        { pin_hash: "h_pin_leak", token_hash: "h_tok_leak", password_hash: "h_pw_leak" },
        "probe",
      ),
    );
    for (const leak of ["h_pin_leak", "h_tok_leak", "h_pw_leak"]) expect(raw).not.toContain(leak);
  });

  it("every number in a phones array keeps only its last 3 digits", () => {
    const line = JSON.parse(
      capture((log) => log.info({ phones: ["96550012345", "96560098765"] }, "probe")),
    );
    expect(line).toMatchObject({ phones: ["***345", "***765"] });
  });
});

describe("plural secret containers", () => {
  it("passwords, tokens and hashes are redacted whole, before their children", () => {
    const raw = capture((log) =>
      log.info(
        {
          passwords: { app: "pw_app_leak", auth: "pw_auth_leak" },
          tokens: ["t_leak"],
          hashes: { a: "h_leak" },
        },
        "probe",
      ),
    );
    for (const leak of ["pw_app_leak", "pw_auth_leak", "t_leak", "h_leak"])
      expect(raw).not.toContain(leak);
  });

  it("ordinary plurals are kept (statuses, tags)", () => {
    const line = JSON.parse(
      capture((log) => log.info({ statuses: ["open"], tags: ["x"] }, "probe")),
    );
    expect(line).toMatchObject({ statuses: ["open"], tags: ["x"] });
  });

  it("redacts `addresses` — it contains the patient-identity part `address`", () => {
    expect(sanitize({ addresses: ["x"] })).toEqual({ addresses: REDACTED });
  });
});

describe("credentials inside URLs", () => {
  it("a connection URL keeps its scheme and host but not its password, under any key and at any depth", () => {
    const line = JSON.parse(
      capture((log) =>
        log.info(
          {
            DATABASE_URL: "postgres://eyadex_app:pg_pw_leak@127.0.0.1:5432/eyadex",
            config: { REDIS_URL: "redis://:redis_pw_leak@127.0.0.1:6379" },
            links: ["https://user:link_pw_leak@example.com/x"],
          },
          "probe",
        ),
      ),
    );
    const raw = JSON.stringify(line);
    for (const leak of ["pg_pw_leak", "redis_pw_leak", "link_pw_leak", "eyadex_app:"]) {
      expect(raw).not.toContain(leak);
    }
    expect(line).toMatchObject({ DATABASE_URL: "postgres://***@127.0.0.1:5432/[REDACTED]" });
  });

  it("dsn and connectionString keys are redacted whole", () => {
    const raw = capture((log) =>
      log.info({ dsn: "dsn_leak", connection_string: "cs_leak" }, "probe"),
    );
    expect(raw).not.toContain("dsn_leak");
    expect(raw).not.toContain("cs_leak");
  });
});

describe("sanitize on the values a screen or a job hands over", () => {
  it("an audit snapshot keeps the clinic fields and the name, and loses the medical ones", () => {
    const snapshot = redactSecrets({
      clinicId: "01920000-0000-7000-8000-00000000c001",
      branchId: "01920000-0000-7000-8000-00000000b001",
      status: "active",
      patients: [{ fullName: "SYNTHETIC NAME", civilId: "300000000000", birthDate: "1990-01-01" }],
    });
    expect(snapshot).toEqual({
      clinicId: "01920000-0000-7000-8000-00000000c001",
      branchId: "01920000-0000-7000-8000-00000000b001",
      status: "active",
      patients: [{ fullName: "SYNTHETIC NAME", civilId: REDACTED, birthDate: REDACTED }],
    });
  });

  it("an operational log line loses the patient container whole", () => {
    expect(
      sanitize({
        clinicId: "01920000-0000-7000-8000-00000000c001",
        patients: [{ fullName: "SYNTHETIC NAME", civilId: "300000000000" }],
      }),
    ).toEqual({ clinicId: "01920000-0000-7000-8000-00000000c001", patients: REDACTED });
  });
});
