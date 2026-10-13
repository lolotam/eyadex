import { Writable } from "node:stream";

import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { systemUuidV7 } from "@eyadex/ids";
import { createLogger } from "@eyadex/observability";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { apiAdapter, apiModule, startApi } from "../../app.ts";
import { API_LOG_EVENTS } from "../log-events.ts";
import { Public } from "../../modules/identity/access/access-rules.ts";
import { PinoNestLogger } from "../nest-logger.ts";
import { ZodValidationPipe } from "../zod-validation.pipe.ts";
import { ServiceUnavailableError } from "../errors.ts";

// A contract-shaped input, validated by the same pipe every controller will use. The schema is declared here
// because packages/contracts is still TypeScript source the API cannot import at runtime (see config.ts).
const probeInput = z.object({
  clinic_id: z.string().uuid(),
  civil_id: z.string().min(8),
});

// Test-only routes: a validated body, a deliberate crash, and one that logs what must not be logged.
@Controller("probe")
class ProbeController {
  @Get("unavailable")
  @Public()
  unavailable(): never {
    throw new ServiceUnavailableError({ code: "unavailable" });
  }
  @Post("patient")
  @Public()
  create(@Body(new ZodValidationPipe(probeInput)) body: unknown): unknown {
    return body;
  }

  @Get("crash")
  @Public()
  crash(): never {
    throw new Error("SELECT * FROM patients WHERE civil_id = 123456789012 — must not leak");
  }

  @Get("throw-string")
  @Public()
  throwString(): never {
    throw "civil_id=123456789012";
  }

  @Get("log-medical")
  @Public()
  logMedical(@Req() request: FastifyRequest): { logged: true } {
    request.log.info({ civilId: "123456789012", phone: "+96550012345" }, "probe");
    return { logged: true };
  }
}

let app: NestFastifyApplication;
let logs = "";

const request = async (method: "GET" | "POST", url: string, payload?: Record<string, unknown>) => {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
};

beforeAll(async () => {
  const sink = new Writable({
    write(chunk, _encoding, done) {
      logs += String(chunk);
      done();
    },
  });
  const logger = createLogger("info", {
    destination: sink,
    events: [...API_LOG_EVENTS, "probe"],
  });
  const ids = systemUuidV7();
  // Built through @nestjs/testing: the same module the composition root builds, compiled by Nest itself.
  const moduleRef = await Test.createTestingModule({
    imports: [apiModule({ ids }, logger, [ProbeController])],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(apiAdapter(logger, ids), {
    logger: new PinoNestLogger(logger),
    abortOnError: false,
  });
  await startApi(app);
});

afterAll(async () => {
  await app.close();
});

describe("an unknown route", () => {
  it("preserves the unconfigured dependency detail in a 503 envelope", async () => {
    const res = await request("GET", "/v1/probe/unavailable");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: "unknown", details: { code: "unavailable" } });
  });
  it("is 404 not_found in the bilingual envelope, with no details", async () => {
    const res = await request("GET", "/v1/nothing-here");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      code: "not_found",
      message_ar: "غير موجود",
      message_en: "Not found",
    });
  });
});

describe("a body that does not satisfy its contract", () => {
  it("is 400 validation with paths and codes, never the rejected values", async () => {
    const res = await request("POST", "/v1/probe/patient", {
      clinic_id: "not-a-uuid",
      civil_id: "1234567",
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "validation",
      message_ar: "بعض الحقول غير صحيحة",
      message_en: "Some fields are invalid",
    });
    expect(res.body["details"]).toEqual([
      { path: ["clinic_id"], code: "invalid_string" },
      { path: ["civil_id"], code: "too_small" },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/not-a-uuid|1234567/);
  });

  it("passes a valid body through the contract", async () => {
    const res = await request("POST", "/v1/probe/patient", {
      clinic_id: "01920000-0000-7000-8000-00000000c001",
      civil_id: "synthetic-identifier",
    });
    expect(res).toEqual({
      status: 201,
      body: { clinic_id: "01920000-0000-7000-8000-00000000c001", civil_id: "synthetic-identifier" },
    });
  });
});

describe("an unexpected error", () => {
  it("is 500 unknown with generic bilingual messages, and leaks nothing from the error", async () => {
    const res = await request("GET", "/v1/probe/crash");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      code: "unknown",
      message_ar: "حدث خطأ ما",
      message_en: "Something went wrong",
    });
    expect(res.body).not.toHaveProperty("details");
    expect(res.body).not.toHaveProperty("stack");
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|patients|123456789012/);
  });

  it("is logged once, sanitised — the message and the identifier stay out of the logs too", async () => {
    logs = "";
    await request("GET", "/v1/probe/crash");
    expect(logs).toContain('"msg":"unhandled error"');
    expect(logs).not.toContain("SELECT");
    expect(logs).not.toContain("123456789012");
    expect(logs).toContain('"type":"Error"');
  });

  it("is 500 unknown for a thrown string, and its content reaches neither the client nor the logs", async () => {
    const res = await request("GET", "/v1/probe/throw-string");
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: "unknown" });
    expect(logs).not.toContain("123456789012");
    expect(logs).toContain('"type":"NonError"');
  });
});

describe("what a handler logs goes through the redaction list", () => {
  it("a civil ID and a phone number logged by a handler never reach the output", async () => {
    logs = "";
    await request("GET", "/v1/probe/log-medical");
    expect(logs).toContain('"msg":"probe"');
    expect(logs).not.toContain("123456789012");
    expect(logs).toContain("***345");
  });
});

describe("errors the router raises before Nest runs", () => {
  it("still answers with the envelope, and the malformed input is not echoed", async () => {
    const res = await app.inject({ method: "GET", url: "/%ZZ_echo_me" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "validation" });
    expect(res.body).not.toContain("echo_me");
  });
});
