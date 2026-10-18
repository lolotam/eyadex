import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  call,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { setModule } from "../../medical/__tests__/medical-fixtures.ts";
import { platformStaff } from "../../platform/__tests__/platform-staff.ts";
import {
  financeClinic,
  manualInvoice,
  namedPatient,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

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
  ["POST", `/v1/invoices/${ID}/send`, { channel: "email", sendRequestId: ID }],
  ["GET", `/v1/invoices/${ID}/pdf`],
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

describe("platform patient-name isolation", () => {
  it("refuses the invoice list to a platform-staff session without exposing a name", async () => {
    const name = "مراجع تجريبي محجوب عن المنصة";
    const patient = await namedPatient(h, C, C.branchD, name);
    await setPrefixes(h, C);
    await manualInvoice(h, C.admin.cookie, patient, C.branchD);
    const staff = await platformStaff(h);
    const res = await call(h, {
      method: "GET",
      url: "/v1/invoices",
      host: PLATFORM,
      cookie: staff.cookie,
    });
    expect([res.statusCode, res.json().code]).toEqual([404, "not_found"]);
    expect(JSON.stringify(res.json())).not.toContain(name);
    const clinicHost = await send(h, staff.cookie, "GET", "/v1/invoices");
    expect([clinicHost.statusCode, clinicHost.json().code]).toEqual([401, "unauthorized"]);
    expect(JSON.stringify(clinicHost.json())).not.toContain(name);
  });

  it("denies SELECT full_name to the eyadex_platform login even with a clinic context", async () => {
    const url = process.env["EYADEX_TEST_PLATFORM_URL"];
    if (url === undefined) throw new Error("EYADEX_TEST_PLATFORM_URL is not set");
    const platform = postgres(url, { max: 1 });
    try {
      await expect(
        platform.begin(async (tx) => {
          await tx`SELECT set_config('app.clinic_id', ${C.clinicId}, true)`;
          return tx`SELECT full_name FROM patients`;
        }),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await platform.end();
    }
  });
});

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
