import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { auditCategorySchema } from "@eyadex/contracts/audit";
import { patientNotificationListSchema } from "@eyadex/contracts/notifications";
import { updateSubscriptionRequestSchema } from "@eyadex/contracts/platform-clinics";
import { appointmentStatusInputSchema } from "@eyadex/contracts/appointments";
import { WHATSAPP_RISK_VERSION, whatsappConnectRequestSchema } from "@eyadex/contracts/whatsapp";
import { systemUuidV7 } from "@eyadex/ids";
import { createLogger } from "@eyadex/observability";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { apiAdapter, apiModule, startApi } from "../../app.ts";
import { Public } from "../../modules/identity/access/access-rules.ts";
import { parseContract } from "../contract-parser.ts";
import { PinoNestLogger } from "../nest-logger.ts";
import { ZodValidationPipe } from "../zod-validation.pipe.ts";

const VALIDATION = {
  code: "validation",
  message_ar: "بعض الحقول غير صحيحة",
  message_en: "Some fields are invalid",
};
const MARKER = "synthetic-status";
const CHANNEL_MARKER = "synthetic-channel";
const VERSION_MARKER = "synthetic-version";
const CATEGORY_MARKER = "synthetic-category";

const notificationItem = (channel: unknown) => ({
  id: "00000000-0000-7000-8000-000000000001",
  kind: "booked",
  channel,
  status: "queued",
  skipReason: null,
  route: null,
  createdAt: "2026-10-26T00:00:00Z",
  sentAt: null,
  failureReason: null,
  deliveredAt: null,
  readAt: null,
});

// The response candidate is not the request. A classifier that reads the request would see the decoy.
const RESPONSE_NULL_STATUS = { status: null };
const RESPONSE_MARKER_STATUS = { status: MARKER };
const RESPONSE_VALID_STATUS = { status: "active" };
const RESPONSE_NESTED = { items: [notificationItem(123)] };

@Controller("zod-enum")
class EnumTypeController {
  @Post("subscription")
  @Public()
  @HttpCode(200)
  subscription(
    @Body(new ZodValidationPipe(updateSubscriptionRequestSchema)) body: unknown,
  ): unknown {
    return body;
  }

  @Post("appointment-status")
  @Public()
  @HttpCode(200)
  appointmentStatus(
    @Body(new ZodValidationPipe(appointmentStatusInputSchema)) body: unknown,
  ): unknown {
    return body;
  }

  @Post("connect")
  @Public()
  connect(@Body(new ZodValidationPipe(whatsappConnectRequestSchema)) body: unknown): unknown {
    return body;
  }

  @Post("response-status")
  @Public()
  responseStatus(): unknown {
    return parseContract(updateSubscriptionRequestSchema, RESPONSE_NULL_STATUS);
  }

  @Post("response-marker")
  @Public()
  responseMarker(): unknown {
    return parseContract(updateSubscriptionRequestSchema, RESPONSE_MARKER_STATUS);
  }

  @Post("response-valid")
  @Public()
  @HttpCode(200)
  responseValid(): unknown {
    return parseContract(updateSubscriptionRequestSchema, RESPONSE_VALID_STATUS);
  }

  @Post("response-nested")
  @Public()
  responseNested(): unknown {
    return parseContract(patientNotificationListSchema, RESPONSE_NESTED);
  }

  @Post("response-category")
  @Public()
  responseCategory(): unknown {
    return parseContract(auditCategorySchema, null);
  }

  @Post("response-category-string")
  @Public()
  responseCategoryString(): unknown {
    return parseContract(auditCategorySchema, CATEGORY_MARKER);
  }
}

const lines: string[] = [];
let app: NestFastifyApplication;

const request = async (url: string, payload: Record<string, unknown>) => {
  const res = await app.inject({ method: "POST", url, payload });
  const body: Record<string, unknown> = res.json();
  return { status: res.statusCode, body };
};

beforeAll(async () => {
  const logger = createLogger("info", {
    destination: {
      write(chunk: string | Uint8Array): void {
        lines.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      },
    },
  });
  const ids = systemUuidV7();
  const moduleRef = await Test.createTestingModule({
    imports: [apiModule({ ids }, logger, [EnumTypeController])],
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

describe("request pipe enum type codes", () => {
  it.each([
    ["null", null],
    ["number", 123],
    ["boolean", true],
    ["array", []],
    ["object", {}],
  ] as const)("maps a %s subscription status to invalid_type", async (_label, status) => {
    const res = await request("/v1/zod-enum/subscription", { status });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ...VALIDATION,
      details: [{ path: ["status"], code: "invalid_type" }],
    });
  });

  it("keeps a bad string status as invalid_enum_value and does not echo the marker", async () => {
    const res = await request("/v1/zod-enum/subscription", { status: MARKER });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ...VALIDATION,
      details: [{ path: ["status"], code: "invalid_enum_value" }],
    });
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
  });

  it("maps a missing required enum to invalid_type", async () => {
    const res = await request("/v1/zod-enum/appointment-status", {});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ...VALIDATION,
      details: [{ path: ["status"], code: "invalid_type" }],
    });
  });

  it("returns a valid status unchanged", async () => {
    const res = await request("/v1/zod-enum/subscription", { status: "trial" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "trial" });
  });

  it("keeps a wrong-primitive singleton literal as invalid_literal", async () => {
    const res = await request("/v1/zod-enum/connect", {
      acceptRisk: 1,
      riskVersion: WHATSAPP_RISK_VERSION,
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ...VALIDATION,
      details: [{ path: ["acceptRisk"], code: "invalid_literal" }],
    });
  });

  it("keeps a wrong-primitive version literal as invalid_literal and does not echo the marker", async () => {
    const res = await request("/v1/zod-enum/connect", {
      acceptRisk: true,
      riskVersion: VERSION_MARKER,
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ...VALIDATION,
      details: [{ path: ["riskVersion"], code: "invalid_literal" }],
    });
    expect(JSON.stringify(res.body)).not.toContain(VERSION_MARKER);
  });
});

describe("response parse enum type codes", () => {
  it("maps a non-string response enum to invalid_type, not the request decoy", async () => {
    const res = await request("/v1/zod-enum/response-status", { status: MARKER });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ...VALIDATION,
      details: [{ path: ["status"], code: "invalid_type" }],
    });
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
    expect(JSON.stringify(res.body)).not.toContain("Invalid option");
  });

  it("keeps a bad string response enum as invalid_enum_value despite a null request decoy", async () => {
    const res = await request("/v1/zod-enum/response-marker", { status: null });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ...VALIDATION,
      details: [{ path: ["status"], code: "invalid_enum_value" }],
    });
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
  });

  it("returns a valid response status unchanged", async () => {
    const res = await request("/v1/zod-enum/response-valid", { status: MARKER });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(RESPONSE_VALID_STATUS);
    expect(JSON.stringify(res.body)).not.toContain(MARKER);
  });

  it("maps a nested array enum number to invalid_type and does not echo the decoy", async () => {
    const res = await request("/v1/zod-enum/response-nested", {
      items: [notificationItem(CHANNEL_MARKER)],
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ...VALIDATION,
      details: [{ path: ["items", "0", "channel"], code: "invalid_type" }],
    });
    expect(JSON.stringify(res.body)).not.toContain(CHANNEL_MARKER);
    expect(JSON.stringify(res.body)).not.toContain("123");
  });

  it("maps a root audit category null to invalid_type, not the request decoy", async () => {
    const res = await request("/v1/zod-enum/response-category", { category: CATEGORY_MARKER });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ...VALIDATION,
      details: [{ path: [], code: "invalid_type" }],
    });
    expect(JSON.stringify(res.body)).not.toContain(CATEGORY_MARKER);
  });

  it("keeps a bad string root category as invalid_enum_value despite a null decoy", async () => {
    const res = await request("/v1/zod-enum/response-category-string", { category: null });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ...VALIDATION,
      details: [{ path: [], code: "invalid_enum_value" }],
    });
    expect(JSON.stringify(res.body)).not.toContain(CATEGORY_MARKER);
  });
});

describe("enum failure logs", () => {
  it("does not echo markers or native issue messages from its own requests", async () => {
    const start = lines.length;
    await request("/v1/zod-enum/subscription", { status: MARKER });
    await request("/v1/zod-enum/connect", { acceptRisk: true, riskVersion: VERSION_MARKER });
    await request("/v1/zod-enum/response-nested", { items: [notificationItem(CHANNEL_MARKER)] });
    await request("/v1/zod-enum/response-category", { category: CATEGORY_MARKER });
    const logged = lines.slice(start).join("\n");
    expect(logged).not.toContain(MARKER);
    expect(logged).not.toContain(CHANNEL_MARKER);
    expect(logged).not.toContain(VERSION_MARKER);
    expect(logged).not.toContain(CATEGORY_MARKER);
    expect(logged).not.toContain("Invalid option");
    expect(logged).not.toContain("Invalid enum");
  });
});
