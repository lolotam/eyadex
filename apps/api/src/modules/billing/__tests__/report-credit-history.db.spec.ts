import { reportPatientCreditResponseSchema } from "@eyadex/contracts/finance-reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeHarness } from "../../identity/auth/__tests__/auth-http-harness.ts";
import { applyCredit, namedPatient, pay, refund } from "./billing-fixtures.ts";
import { editTo } from "./money-fixtures.ts";
import {
  issueReportInvoice,
  reportFixture,
  reportFreeLine,
  type ReportFixture,
} from "./report-fixtures.ts";

let f: ReportFixture;
beforeAll(async () => {
  f = await reportFixture();
}, 120_000);
afterAll(() => closeHarness(f.h));

describe("R6 oldest available credit", () => {
  it.each(["allocation", "credit refund", "payment refund"] as const)(
    "ignores credit exhausted by %s and dates only the remaining balance",
    async (spentBy) => {
      const { h, C } = f;
      const patient = await namedPatient(h, C, C.branchR, "مراجع تاريخ الرصيد");
      const old = await issueReportInvoice(f, patient, C.branchR, [reportFreeLine("1000")]);
      const payment = await pay(h, C.admin.cookie, old.id, {
        method: "knet",
        amountMinor: "1000",
      });
      expect(payment.statusCode, payment.body).toBe(201);
      if (spentBy === "payment refund") {
        const res = await refund(h, C.admin.cookie, old.id, {
          source: "payment",
          paymentId: (payment.json() as { payment: { id: string } }).payment.id,
          method: "knet",
          amountMinor: "400",
          reason: "sample payment return",
        });
        expect(res.statusCode, res.body).toBe(201);
      } else {
        expect((await editTo(h, C.admin.cookie, old.id, "600", '"1"')).statusCode).toBe(200);
        const spent =
          spentBy === "allocation"
            ? await applyCredit(
                h,
                C.admin.cookie,
                (await issueReportInvoice(f, patient, C.branchR, [reportFreeLine("400")])).id,
                "400",
              )
            : await refund(h, C.admin.cookie, old.id, {
                source: "credit",
                method: "knet",
                amountMinor: "400",
                reason: "sample credit return",
              });
        expect(spent.statusCode, spent.body).toBe(201);
      }
      await h.owner`UPDATE patient_credits SET created_at = '2025-01-01T09:00:00Z'
        WHERE clinic_id = ${C.clinicId} AND patient_id = ${patient}`;
      const empty = reportPatientCreditResponseSchema.parse((await f.get("patient-credit")).json());
      expect(empty.items.some((row) => row.patientId === patient)).toBe(false);

      const fresh = await issueReportInvoice(f, patient, C.branchR, [reportFreeLine("1000")]);
      expect(
        (await pay(h, C.admin.cookie, fresh.id, { method: "knet", amountMinor: "1000" }))
          .statusCode,
      ).toBe(201);
      expect((await editTo(h, C.admin.cookie, fresh.id, "600", '"1"')).statusCode).toBe(200);
      await h.owner`UPDATE patient_credits SET created_at = '2026-05-31T22:30:00Z'
        WHERE clinic_id = ${C.clinicId} AND patient_id = ${patient}
          AND origin_allocation_id IN (SELECT id FROM payment_allocations
            WHERE clinic_id = ${C.clinicId} AND invoice_id = ${fresh.id})`;
      const target = await issueReportInvoice(f, patient, C.branchR, [reportFreeLine("100")]);
      expect((await applyCredit(h, C.admin.cookie, target.id, "100")).statusCode).toBe(201);
      const res = await f.get("patient-credit");
      expect(res.statusCode, res.body).toBe(200);
      const report = reportPatientCreditResponseSchema.parse(res.json());
      expect(report.items.find((row) => row.patientId === patient)).toMatchObject({
        balanceMinor: "300",
        oldestCreditDay: "2026-06-01",
      });
    },
    60_000,
  );
});
