import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import {
  auditSince,
  financeClinic,
  manualInvoice,
  pay,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// Finance F2 (spec §4.6, FIN-11): the clinic's payment methods — the four in a fixed order, each one
// switched off on its own, and the administrative row of the change.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;

type Method = { method: string; enabled: boolean };

const ALL_ON: Method[] = [
  { method: "cash", enabled: true },
  { method: "knet", enabled: true },
  { method: "bank_transfer", enabled: true },
  { method: "other", enabled: true },
];
const knetOff: Method[] = ALL_ON.map((setting) =>
  setting.method === "knet" ? { ...setting, enabled: false } : setting,
);
const allOff: Method[] = ALL_ON.map((setting) => ({ ...setting, enabled: false }));
const cash = (amountMinor: string) => ({ method: "cash", amountMinor });
const knet = (amountMinor: string) => ({ method: "knet", amountMinor });

const settings = () => send(h, C.admin.cookie, "GET", "/v1/clinic/settings/finance");
const save = (paymentMethods: Method[]) =>
  send(h, C.admin.cookie, "PUT", "/v1/clinic/settings/payment-methods", { paymentMethods });
const methodsOf = (res: { json: () => unknown }) =>
  (res.json() as { paymentMethods: Method[] }).paymentMethods;

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
});

afterAll(() => closeHarness(h));

describe("the payment methods setting (FIN-11)", () => {
  it("shows the four methods in the fixed order, all on, while the clinic saved nothing", async () => {
    const res = await settings();
    expect(res.statusCode, res.body).toBe(200);
    expect(methodsOf(res)).toEqual(ALL_ON);
  });

  it("switches one method off and refuses a payment of that method only", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD, "2000");
    try {
      const saved = await save(knetOff);
      expect(saved.statusCode, saved.body).toBe(200);
      expect(methodsOf(saved)).toEqual(knetOff);
      expect(methodsOf(await settings())).toEqual(knetOff);
      const knetPay = await pay(h, C.admin.cookie, invoice.id, knet("1000"));
      expect([knetPay.statusCode, code(knetPay)]).toEqual([409, "payment_method_disabled"]);
      const cashPay = await pay(h, C.admin.cookie, invoice.id, cash("1000"));
      expect(cashPay.statusCode, cashPay.body).toBe(201);
    } finally {
      await save(ALL_ON);
    }
  });

  it("refuses to switch every method off and keeps the settings as they were", async () => {
    await save(ALL_ON);
    const res = await save(allOff);
    expect([res.statusCode, code(res)]).toEqual([400, "payment_methods_empty"]);
    expect(methodsOf(await settings())).toEqual(ALL_ON);
  });

  it("refuses a member without the clinic settings key", async () => {
    const res = await send(h, C.desk.cookie, "PUT", "/v1/clinic/settings/payment-methods", {
      paymentMethods: knetOff,
    });
    expect([res.statusCode, code(res)]).toEqual([403, "forbidden"]);
  });

  it("writes one administrative row with the methods before and after", async () => {
    await save(ALL_ON);
    const since = new Date();
    try {
      const res = await save(knetOff);
      expect(res.statusCode, res.body).toBe(200);
      const rows = (await auditSince(h, C.clinicId, since)).filter(
        (row) => row["action"] === "payment_methods.changed",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: "payment_methods.changed",
        category: "administrative",
        entity_type: "payment_methods",
      });
      const details = rows[0]!["details"] as {
        before: { paymentMethods: Method[] };
        after: { paymentMethods: Method[] };
      };
      expect(details.before.paymentMethods).toEqual(ALL_ON);
      expect(details.after.paymentMethods).toEqual(knetOff);
    } finally {
      await save(ALL_ON);
    }
  });
});
