import { Body, Controller, Post } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { platformClinicFinanceRequestSchema } from "@eyadex/contracts/finance";
import { parseMetaWebhook } from "../../modules/notifications/domain/meta-webhook.ts";
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

@Controller("zod-migration-integers")
class IntegerMigrationController {
  @Post("tax")
  @Public()
  tax(@Body(new ZodValidationPipe(platformClinicFinanceRequestSchema)) body: unknown): unknown {
    return body;
  }

  @Post("tax-raw")
  @Public()
  taxRaw(@Body() body: unknown): unknown {
    return platformClinicFinanceRequestSchema.parse(body);
  }
}

let app: NestFastifyApplication;

const request = async (payload: Record<string, unknown>) => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/zod-migration-integers/tax",
    payload,
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
};

const rawJson = async (url: string, payload: string) => {
  const res = await app.inject({
    method: "POST",
    url,
    headers: { "content-type": "application/json" },
    payload,
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
};

beforeAll(async () => {
  const logger = createLogger("silent");
  const ids = systemUuidV7();
  const moduleRef = await Test.createTestingModule({
    imports: [apiModule({ ids }, logger, [IntegerMigrationController])],
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

describe("taxRateBp integer envelope", () => {
  it("keeps the integer issue and then the range issue, in that order", async () => {
    const low = await request({ taxRateBp: -0.5 });
    expect(low.status).toBe(400);
    expect(low.body).toEqual({
      ...VALIDATION,
      details: [
        { path: ["taxRateBp"], code: "invalid_type" },
        { path: ["taxRateBp"], code: "too_small" },
      ],
    });

    const high = await request({ taxRateBp: 10000.5 });
    expect(high.body).toEqual({
      ...VALIDATION,
      details: [
        { path: ["taxRateBp"], code: "invalid_type" },
        { path: ["taxRateBp"], code: "too_big" },
      ],
    });
  });

  it("does not add a safe-integer code for a huge integer above the bound", async () => {
    const res = await request({ taxRateBp: 1e20 });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ...VALIDATION,
      details: [{ path: ["taxRateBp"], code: "too_big" }],
    });
    expect(JSON.stringify(res.body)).not.toContain("1e");
  });

  it("keeps both overflow issues from a raw JSON 1e999 body, through the pipe and a raw ZodError", async () => {
    const cases = [
      { url: "/v1/zod-migration-integers/tax", body: '{"taxRateBp":1e999}', range: "too_big" },
      { url: "/v1/zod-migration-integers/tax", body: '{"taxRateBp":-1e999}', range: "too_small" },
      { url: "/v1/zod-migration-integers/tax-raw", body: '{"taxRateBp":1e999}', range: "too_big" },
      {
        url: "/v1/zod-migration-integers/tax-raw",
        body: '{"taxRateBp":-1e999}',
        range: "too_small",
      },
    ] as const;
    for (const item of cases) {
      const res = await rawJson(item.url, item.body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        ...VALIDATION,
        details: [
          { path: ["taxRateBp"], code: "invalid_type" },
          { path: ["taxRateBp"], code: item.range },
        ],
      });
      expect(JSON.stringify(res.body)).not.toContain("Infinity");
      expect(JSON.stringify(res.body)).not.toContain("1e999");
    }
  });
});

describe("Meta error code", () => {
  it("keeps a failed status whose code is outside the safe-integer range", () => {
    expect(
      parseMetaWebhook(
        {
          entry: [
            {
              changes: [
                {
                  field: "messages",
                  value: {
                    metadata: { phone_number_id: "1234567" },
                    statuses: [
                      { id: "wamid.overflow", status: "failed", errors: [{ code: 1e20 }] },
                    ],
                  },
                },
              ],
            },
          ],
        },
        new Date("2027-01-01T12:00:00.000Z"),
      ),
    ).toEqual([
      {
        phoneNumberId: "1234567",
        updates: [
          { messageId: "wamid.overflow", update: { kind: "failed", code: "meta_rejected" } },
        ],
      },
    ]);
  });
});
