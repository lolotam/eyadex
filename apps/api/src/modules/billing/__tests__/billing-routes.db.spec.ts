import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { setModule } from "../../medical/__tests__/medical-fixtures.ts";
import { financeClinic, type FinanceClinic } from "./billing-fixtures.ts";

// Plan Task 8: every billing route answers module_disabled while finance is off.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;

const ID = randomUUID();
const ROUTES: [method: "GET" | "POST" | "PATCH" | "PUT", url: string, body?: unknown][] = [
  ["GET", "/v1/prices"],
  ["PATCH", `/v1/services/${ID}/price`, { priceMinor: "1000" }],
  ["PUT", `/v1/services/${ID}/provider-prices`, { items: [] }],
  ["GET", `/v1/invoices/draft?source=appointment&id=${ID}`],
  ["POST", "/v1/invoices", {}],
  ["GET", "/v1/invoices"],
  ["GET", `/v1/invoices/${ID}`],
  ["PATCH", `/v1/invoices/${ID}`, { lines: [], invoiceDiscount: null }],
  ["POST", `/v1/invoices/${ID}/void`, { reason: "x" }],
  ["GET", "/v1/clinic/settings/finance"],
  ["PATCH", "/v1/clinic/settings/finance", { commercialRegNo: null }],
  ["GET", "/v1/clinic/logo"],
  ["GET", "/v1/invoice-prefixes"],
  ["PUT", `/v1/invoice-prefixes/${ID}`, { invoicePrefix: "ABC" }],
];

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
});

afterAll(() => closeHarness(h));

describe("module flag (plan Task 8)", () => {
  it.each(ROUTES)("%s %s is module_disabled while finance is off", async (method, url, body) => {
    await setModule(h, invalidate, C.clinicId, "finance", false);
    try {
      const res = await send(h, C.admin.cookie, method, url, body);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: "module_disabled", details: { module: "finance" } });
    } finally {
      await setModule(h, invalidate, C.clinicId, "finance", true);
    }
  });
});
