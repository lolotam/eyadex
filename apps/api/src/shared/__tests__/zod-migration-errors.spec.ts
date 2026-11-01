import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createBranchRequestSchema } from "@eyadex/contracts/branches";
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
import { parseContract } from "../contract-parser.ts";
import { ZodValidationPipe } from "../zod-validation.pipe.ts";

const VALIDATION = {
  code: "validation",
  message_ar: "بعض الحقول غير صحيحة",
  message_en: "Some fields are invalid",
};
const NAME_MARKER = "length-marker";
const EMAIL_MARKER = "email-marker";
const LONG_NAME = "n".repeat(101);
const branchShapes: Record<string, Record<string, unknown>> = {
  empty: { nameAr: [], nameEn: "Synthetic" },
  oversized: { nameAr: Array<string>(121).fill(NAME_MARKER), nameEn: "Synthetic" },
  zero: { nameAr: { length: 0 }, nameEn: "Synthetic" },
  huge: { nameAr: { length: 999 }, nameEn: "Synthetic" },
  short: { nameAr: "", nameEn: "Synthetic" },
  long: { nameAr: LONG_NAME, nameEn: "Synthetic" },
};

function branchShape(shape: string): Record<string, unknown> {
  const input = branchShapes[shape];
  if (input === undefined) throw new Error(`unknown branch shape: ${shape}`);
  return input;
}
function expectEnv(
  res: { status: number; body: Record<string, unknown> },
  details: { path: string[]; code: string }[],
): void {
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ ...VALIDATION, details });
  expect(JSON.stringify(res.body)).not.toMatch(
    /length-marker|email-marker|Synthetic|a@b\.co|999|length|array|unknown|pattern|"inst"|"input"|synthetic-marker|n{101}/,
  );
}

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

  @Post("i")
  @Public()
  invite(@Body(new ZodValidationPipe(invitePlatformAccountInputSchema)) body: unknown): unknown {
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

  @Post("branch")
  @Public()
  branch(@Body(new ZodValidationPipe(createBranchRequestSchema)) body: unknown): unknown {
    return body;
  }

  @Post("held/:boundary/:shape")
  @Public()
  held(@Param("boundary") boundary: string, @Param("shape") shape: string): unknown {
    if (boundary === "enum") {
      const parsed = updateSubscriptionRequestSchema.safeParse({ status: "synthetic-marker" });
      if (parsed.success) throw new Error("expected an enum failure");
      throw parsed.error;
    }
    const input = branchShape(shape);
    if (boundary === "raw") {
      const parsed = createBranchRequestSchema.safeParse(input);
      if (parsed.success) throw new Error("expected a branch failure");
      throw parsed.error;
    }
    return parseContract(createBranchRequestSchema, input);
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

describe("aborted string-length artifacts", () => {
  const typeOnly = [{ path: ["nameAr"], code: "invalid_type" }];
  const at = (path: string, code: string) => [{ path: [path], code }];
  const post = (url: string, payload?: Record<string, unknown>) =>
    request("POST", `/v1/zod-migration/${url}`, payload);

  it("omits them on the pipe, the raw filter, and response parse", async () => {
    for (const shape of ["empty", "oversized", "zero", "huge"] as const) {
      expectEnv(await post("branch", branchShapes[shape]), typeOnly);
      expectEnv(await post(`held/raw/${shape}`, branchShapes["short"]), typeOnly);
      expectEnv(await post(`held/response/${shape}`, branchShapes["long"]), typeOnly);
    }
  });

  it("keeps real string bounds, a sibling bound, and a raw unknown-string enum", async () => {
    const short = await post("branch", branchShapes["short"]);
    expectEnv(short, at("nameAr", "too_small"));
    expect((await post("held/raw/short", branchShapes["empty"])).body).toEqual(short.body);
    expectEnv(await post("branch", branchShapes["long"]), at("nameAr", "too_big"));
    expectEnv(await post("branch", { nameAr: [], nameEn: "" }), [
      { path: ["nameAr"], code: "invalid_type" },
      { path: ["nameEn"], code: "too_small" },
    ]);
    expectEnv(await post("branch", { nameAr: [], nameEn: LONG_NAME }), [
      { path: ["nameAr"], code: "invalid_type" },
      { path: ["nameEn"], code: "too_big" },
    ]);
    expectEnv(await post("held/enum/marker", { status: null }), at("status", "invalid_enum_value"));
  });

  it("omits invite fullName and email length artifacts and keeps real name bounds", async () => {
    const names = [[], Array<string>(121).fill(NAME_MARKER), { length: 0 }, { length: 999 }];
    for (const fullName of names) {
      expectEnv(await post("i", { fullName, email: "a@b.co" }), at("fullName", "invalid_type"));
    }
    const emails = [[], Array<string>(300).fill(EMAIL_MARKER), { length: 0 }, { length: 999 }];
    for (const email of emails) {
      const body = { fullName: "Synthetic Staff", email };
      expectEnv(await post("i", body), at("email", "invalid_type"));
    }
    expectEnv(await post("i", { fullName: "A", email: "a@b.co" }), at("fullName", "too_small"));
    expectEnv(await post("i", { fullName: LONG_NAME, email: "a@b.co" }), at("fullName", "too_big"));
  });
});
