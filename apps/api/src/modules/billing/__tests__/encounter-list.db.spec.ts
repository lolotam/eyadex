import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn, startedVisit } from "../../medical/__tests__/medical-fixtures.ts";
import {
  financeClinic,
  serviceAppointment,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

let h: Harness;
let C: FinanceClinic;
beforeAll(async () => {
  h = await openHarness({}, true);
  C = await financeClinic(h, h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR));
  await setPrefixes(h, C);
});
afterAll(() => closeHarness(h));

const list = (cookie: string, query: string) => send(h, cookie, "GET", `/v1/invoices?${query}`);

describe("encounter invoice lookup", () => {
  it.each(["appointment", "visit"] as const)(
    "finds the opposite source from %s within invoice reach",
    async (source) => {
      const patient = await patientIn(h, C, C.branchD);
      const appointment = await serviceAppointment(
        h,
        C,
        patient,
        source === "appointment" ? "09:00" : "10:00",
      );
      const visit = await startedVisit(h, C.doctor.cookie, { appointmentId: appointment });
      const pair = { appointment, visit };
      const other = source === "appointment" ? "visit" : "appointment";
      const issued = await send(
        h,
        C.admin.cookie,
        "POST",
        "/v1/invoices",
        {
          source: other,
          sourceId: pair[other],
          patientId: null,
          branchId: null,
          lines: [
            {
              kind: "free",
              descriptionAr: "كشف",
              descriptionEn: "Consultation",
              quantity: 1,
              unitPriceMinor: "1000",
              discount: null,
            },
          ],
          invoiceDiscount: null,
        },
        randomUUID(),
      );
      expect(issued.statusCode, issued.body).toBe(201);
      const { invoice } = issued.json() as { invoice: { id: string } };
      const query = `source=${source}&sourceId=${pair[source]}&status=issued`;
      expect((await list(C.admin.cookie, query)).json()).toMatchObject({ items: [], total: 0 });
      expect((await list(C.admin.cookie, `${query}&encounter=false`)).json()).toMatchObject({
        items: [],
        total: 0,
      });
      const found = await list(C.admin.cookie, `${query}&encounter=true`);
      expect(found.statusCode, found.body).toBe(200);
      expect(found.json()).toMatchObject({ items: [{ id: invoice.id }], total: 1 });
      // The desk only reaches branch R; expanding the source cannot reveal a branch D invoice.
      const hidden = await list(C.desk.cookie, `${query}&encounter=true`);
      expect(hidden.statusCode).toBe(200);
      expect(hidden.json()).toMatchObject({ items: [], total: 0 });
      // A doctor still sees their own patient through the existing own-patient port predicate.
      expect((await list(C.doctor.cookie, `${query}&encounter=true`)).json()).toMatchObject({
        items: [{ id: invoice.id }],
        total: 1,
      });
      expect(
        (await list(C.admin.cookie, `${query}&encounter=true&branchId=${C.branchR}`)).json(),
      ).toMatchObject({ items: [], total: 0 });
    },
  );

  it.each([
    "encounter=true",
    "encounter=false",
    `encounter=true&source=manual&sourceId=${randomUUID()}`,
  ])("refuses %s without an encounter source pair", async (query) => {
    const res = await list(C.admin.cookie, query);
    expect([res.statusCode, code(res)]).toEqual([400, "validation"]);
  });
});
