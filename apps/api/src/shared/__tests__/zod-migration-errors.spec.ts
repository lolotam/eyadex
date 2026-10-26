import { Body, Controller, Get, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { changeRoleInputSchema } from "@eyadex/contracts/users";
import { idSchema } from "@eyadex/contracts/common";
import { invitePlatformAccountInputSchema } from "@eyadex/contracts/platform";
import { invoiceDiscountInputSchema } from "@eyadex/contracts/finance";
import { reportDailyTakingsQuerySchema } from "@eyadex/contracts/finance-reports";
import {
  setFeatureRequestSchema,
  updateSubscriptionRequestSchema,
} from "@eyadex/contracts/platform-clinics";
import { WHATSAPP_RISK_VERSION, whatsappConnectRequestSchema } from "@eyadex/contracts/whatsapp";
import { systemUuidV7 } from "@eyadex/ids";
import { createLogger } from "@eyadex/observability";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { apiAdapter, apiModule, startApi } from "../../app.ts";
import { Public } from "../../modules/identity/access/access-rules.ts";
import { PinoNestLogger } from "../nest-logger.ts";
import { ZodValidationPipe } from "../zod-validation.pipe.ts";

const VALIDATION = {
  code: "validation",
  message_ar: "بعض الحقول غير صحيحة",
  message_en: "Some fields are invalid",
};

@Controller("zod-migration")
class ZodMigrationController {
  @Post("role")
  @Public()
  role(@Body(new ZodValidationPipe(changeRoleInputSchema)) body: unknown): unknown {
    return body;
  }

  @Post("platform-invite")
  @Public()
  platformInvite(
    @Body(new ZodValidationPipe(invitePlatformAccountInputSchema)) body: unknown,
  ): unknown {
    return body;
  }

  @Post("discount")
  @Public()
  discount(@Body(new ZodValidationPipe(invoiceDiscountInputSchema)) body: unknown): unknown {
    return body;
  }

  @Post("feature")
  @Public()
  feature(@Body(new ZodValidationPipe(setFeatureRequestSchema)) body: unknown): unknown {
    return body;
  }

  @Post("subscription")
  @Public()
  subscription(
    @Body(new ZodValidationPipe(updateSubscriptionRequestSchema)) body: unknown,
  ): unknown {
    return body;
  }

  @Post("connect")
  @Public()
  connect(@Body(new ZodValidationPipe(whatsappConnectRequestSchema)) body: unknown): unknown {
    return body;
  }

  @Post("range")
  @Public()
  range(@Body(new ZodValidationPipe(reportDailyTakingsQuerySchema)) body: unknown): unknown {
    return body;
  }

  @Get("raw-id")
  @Public()
  rawId(): never {
    const parsed = idSchema.safeParse("not-a-uuid");
    if (parsed.success) throw new Error("expected a uuid failure");
    throw parsed.error;
  }
}

let app: NestFastifyApplication;

const request = async (method: "GET" | "POST", url: string, payload?: Record<string, unknown>) => {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
};

beforeAll(async () => {
  const logger = createLogger("silent");
  const ids = systemUuidV7();
  const moduleRef = await Test.createTestingModule({
    imports: [apiModule({ ids }, logger, [ZodMigrationController])],
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

describe("ZodValidationPipe envelopes", () => {
  it("keeps a uuid failure as invalid_string and does not echo the marker", async () => {
    const res = await request("POST", "/v1/zod-migration/role", { roleId: "not-a-uuid" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ...VALIDATION,
      details: [{ path: ["roleId"], code: "invalid_string" }],
    });
    expect(JSON.stringify(res.body)).not.toContain("not-a-uuid");
  });

  it("keeps an email failure as invalid_string and does not echo the marker", async () => {
    const res = await request("POST", "/v1/zod-migration/platform-invite", {
      fullName: "Synthetic Staff",
      email: "not-an-email",
    });
    expect(res.body).toEqual({
      ...VALIDATION,
      details: [{ path: ["email"], code: "invalid_string" }],
    });
    expect(JSON.stringify(res.body)).not.toContain("not-an-email");
  });

  it("keeps a multi-option status enum failure as invalid_enum_value and does not echo the marker", async () => {
    const res = await request("POST", "/v1/zod-migration/subscription", {
      status: "synthetic-marker",
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ...VALIDATION,
      details: [{ path: ["status"], code: "invalid_enum_value" }],
    });
    expect(JSON.stringify(res.body)).not.toContain("synthetic-marker");
  });

  it("keeps a discriminator failure, a literal failure, and a strict key as their Zod 3 codes", async () => {
    const discount = await request("POST", "/v1/zod-migration/discount", {
      kind: "other",
      reason: "Synthetic reason",
    });
    expect(discount.body["details"]).toEqual([
      { path: ["kind"], code: "invalid_union_discriminator" },
    ]);
    expect(JSON.stringify(discount.body)).not.toContain("other");

    const literal = await request("POST", "/v1/zod-migration/connect", {
      acceptRisk: false,
      riskVersion: WHATSAPP_RISK_VERSION,
    });
    expect(literal.body["details"]).toEqual([{ path: ["acceptRisk"], code: "invalid_literal" }]);

    const strict = await request("POST", "/v1/zod-migration/feature", { enabled: true, extra: 1 });
    expect(strict.body["details"]).toEqual([{ path: [], code: "unrecognized_keys" }]);
    expect(JSON.stringify(strict.body)).not.toContain("extra");
  });

  it("maps validation.rangeTooLong to report_range_too_long and drops the dates", async () => {
    const res = await request("POST", "/v1/zod-migration/range", {
      from: "2024-01-01",
      to: "2025-01-01",
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: "report_range_too_long",
      message_ar: "الفترة المطلوبة أطول من المسموح.",
      message_en: "The period is longer than allowed.",
    });
    expect(JSON.stringify(res.body)).not.toContain("2024-01-01");
  });
});

describe("a raw ZodError through EnvelopeExceptionFilter", () => {
  it("is the same sanitized validation envelope, with invalid_string and no marker", async () => {
    const res = await request("GET", "/v1/zod-migration/raw-id");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ...VALIDATION,
      details: [{ path: [], code: "invalid_string" }],
    });
    expect(JSON.stringify(res.body)).not.toContain("not-a-uuid");
  });
});
