import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { auditSince, financeClinic, type FinanceClinic } from "./billing-fixtures.ts";

// Plan Task 8a (FIN-A8, R1-13, R2-3): service prices behind the finance module and `prices` keys.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;

type ServicePriceAnswer = {
  servicePrice: {
    serviceId: string;
    priceMinor: string | null;
    providerPrices: { memberId: string; priceMinor: string }[];
  };
};

const setPrice = (cookie: string, serviceId: string, priceMinor: string | null) =>
  send(h, cookie, "PATCH", `/v1/services/${serviceId}/price`, { priceMinor });
const setProviderPrices = (serviceId: string, items: unknown[]) =>
  send(h, C.admin.cookie, "PUT", `/v1/services/${serviceId}/provider-prices`, { items });

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
});

afterAll(() => closeHarness(h));

describe("base price (FIN-A8)", () => {
  it("is saved, listed with the clinic's currency, and cleared with null", async () => {
    const saved = await setPrice(C.admin.cookie, C.serviceId, "15500");
    expect(saved.statusCode).toBe(200);
    expect((saved.json() as ServicePriceAnswer).servicePrice).toEqual({
      serviceId: C.serviceId,
      priceMinor: "15500",
      providerPrices: [],
    });
    const list = await send(h, C.priceReader.cookie, "GET", "/v1/prices");
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      currency: "KWD",
      currencyExponent: 3,
      items: expect.arrayContaining([
        { serviceId: C.serviceId, priceMinor: "15500", providerPrices: [] },
      ]),
    });
    const cleared = await setPrice(C.admin.cookie, C.serviceId, null);
    expect((cleared.json() as ServicePriceAnswer).servicePrice.priceMinor).toBeNull();
  });

  it("keeps a price at the line cap exactly and refuses one above it", async () => {
    const cap = await setPrice(C.admin.cookie, C.serviceId, "1000000000000");
    expect((cap.json() as ServicePriceAnswer).servicePrice.priceMinor).toBe("1000000000000");
    const above = await setPrice(C.admin.cookie, C.serviceId, "1000000000001");
    expect(above.statusCode).toBe(400);
  });

  it("never appears on GET /v1/services (R1-13)", async () => {
    await setPrice(C.admin.cookie, C.serviceId, "15500");
    const services = await send(h, C.admin.cookie, "GET", "/v1/services");
    expect(services.statusCode).toBe(200);
    expect(services.body).not.toContain("15500");
    expect(services.body).not.toContain("price");
  });

  it("answers not_found for a service of no clinic", async () => {
    const res = await setPrice(C.admin.cookie, randomUUID(), "100");
    expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
  });

  it("refuses a member who can read prices but not change them", async () => {
    const res = await setPrice(C.priceReader.cookie, C.serviceId, "100");
    expect(res.statusCode).toBe(403);
  });

  it("writes an administrative audit row with field names, never the amount", async () => {
    const since = new Date();
    await setPrice(C.admin.cookie, C.serviceId, "777123");
    const rows = await auditSince(h, C.clinicId, since);
    expect(rows).toEqual([
      expect.objectContaining({
        action: "service.price_set",
        category: "administrative",
        entity_type: "clinic_service",
        entity_id: C.serviceId,
      }),
    ]);
    expect(JSON.stringify(rows[0]!["details"])).not.toContain("777123");
  });
});

describe("per-doctor prices (FIN-A8)", () => {
  it("replace the service's whole list", async () => {
    const first = await setProviderPrices(C.serviceId, [
      { memberId: C.doctor.memberId, priceMinor: "20000" },
      { memberId: C.admin.memberId, priceMinor: "25000" },
    ]);
    expect(first.statusCode).toBe(200);
    expect((first.json() as ServicePriceAnswer).servicePrice.providerPrices).toHaveLength(2);
    const second = await setProviderPrices(C.serviceId, [
      { memberId: C.doctor.memberId, priceMinor: "21000" },
    ]);
    expect((second.json() as ServicePriceAnswer).servicePrice.providerPrices).toEqual([
      { memberId: C.doctor.memberId, priceMinor: "21000" },
    ]);
  });

  it("refuse a member of no clinic as validation, and keep the list as it was", async () => {
    await setProviderPrices(C.serviceId, [{ memberId: C.doctor.memberId, priceMinor: "21000" }]);
    const res = await setProviderPrices(C.serviceId, [
      { memberId: randomUUID(), priceMinor: "1000" },
    ]);
    expect([res.statusCode, code(res)]).toEqual([400, "validation"]);
    const list = await send(h, C.admin.cookie, "GET", "/v1/prices");
    const items = (list.json() as { items: ServicePriceAnswer["servicePrice"][] }).items;
    expect(items.find((i) => i.serviceId === C.serviceId)?.providerPrices).toEqual([
      { memberId: C.doctor.memberId, priceMinor: "21000" },
    ]);
  });

  it("refuse the same member twice in one list", async () => {
    const res = await setProviderPrices(C.serviceId, [
      { memberId: C.doctor.memberId, priceMinor: "1" },
      { memberId: C.doctor.memberId, priceMinor: "2" },
    ]);
    expect(res.statusCode).toBe(400);
  });
});
