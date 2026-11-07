import { randomUUID } from "node:crypto";
import type { Payment } from "@eyadex/contracts/finance";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { customRole, memberOn } from "../../identity/__tests__/user-fixtures.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { ApiError } from "../../../shared/errors.ts";
import {
  financeClinic,
  manualInvoice,
  namedPatient,
  pay,
  refund,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";
import { voidInvoice } from "./money-fixtures.ts";
import { UnavailableReceiptPdf } from "../rendering/unavailable-receipt-pdf.ts";

let h: Harness, clinic: FinanceClinic, other: FinanceClinic;
let viewer: Awaited<ReturnType<typeof memberOn>>, role: string;
let payment: Payment, outside: Payment, crossClinic: Payment;
let beforeReturn: (() => Promise<void>) | undefined;
let fault: Error | undefined;
const seen: Payment[] = [];
const bytes = Buffer.from("%PDF-synthetic-receipt-boundary");
const open = (id = payment.id, cookie = viewer.cookie) =>
  send(h, cookie, "GET", `/v1/payments/${id}/pdf`);
const audits = () => h.owner`SELECT category, entity_type, entity_id, details FROM audit_log
  WHERE clinic_id = ${clinic.clinicId} AND action = 'payment.pdf_opened'`;

beforeAll(async () => {
  h = await openHarness({}, true, {
    receiptPdf: {
      render: async (_clinicId, source) => {
        seen.push(source);
        await beforeReturn?.();
        if (fault) throw fault;
        return bytes;
      },
    },
  });
  const invalidator = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  clinic = await financeClinic(h, invalidator);
  other = await financeClinic(h, invalidator);
  role = await customRole(h, clinic.clinicId, ["view:payments:branch"]);
  viewer = await memberOn(h, clinic.admin, role, {
    allBranches: false,
    branchIds: [clinic.branchD],
  });
  await invalidator.clinicChanged(clinic.clinicId);
  for (const C of [clinic, other]) await setPrefixes(h, C);
  const make = async (C: FinanceClinic, branch: string) => {
    const invoice = await manualInvoice(
      h,
      C.admin.cookie,
      await namedPatient(h, C, branch, "مراجع تجريبي"),
      branch,
      "10000",
    );
    const result = await pay(h, C.admin.cookie, invoice.id, {
      method: "knet",
      amountMinor: "4000",
      reference: "SYN-REF",
    });
    expect(result.statusCode, result.body).toBe(201);
    return result.json().payment as Payment;
  };
  payment = await make(clinic, clinic.branchD);
  outside = await make(clinic, clinic.branchR);
  crossClinic = await make(other, other.branchD);
});
afterAll(() => closeHarness(h));

describe("receipt PDF delivery", () => {
  it("uses payment permission alone, returns the original amount and records one allowlisted open", async () => {
    const before = (await audits()).length;
    const response = await open();
    expect(response.statusCode, response.body).toBe(200);
    expect(response.rawPayload).toEqual(bytes);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-disposition"]).toContain(`${payment.receiptNumber}.pdf`);
    expect(seen.at(-1)).toMatchObject({
      amountMinor: "4000",
      reference: "SYN-REF",
      patientName: "مراجع تجريبي",
    });
    const rows = await audits();
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toMatchObject({
      category: "patient_access",
      entity_type: "payment",
      entity_id: payment.id,
      details: { before: null, after: null },
    });
  });

  it("refuses an invoice-only reader before rendering, even with an invalid id", async () => {
    const count = seen.length;
    expect((await open(payment.id, clinic.desk.cookie)).statusCode).toBe(403);
    expect((await open("not-an-id", clinic.desk.cookie)).statusCode).toBe(403);
    expect(seen).toHaveLength(count);
  });

  it("hides missing, other branch and other clinic receipts before rendering", async () => {
    const count = seen.length;
    for (const id of [randomUUID(), outside.id, crossClinic.id])
      expect((await open(id)).statusCode).toBe(404);
    expect(seen).toHaveLength(count);
  });

  it("reports typed render failure without a PDF response or audit", async () => {
    const before = (await audits()).length;
    fault = new ApiError("pdf_busy");
    try {
      const response = await open();
      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe("pdf_busy");
      expect(response.headers["content-type"]).not.toBe("application/pdf");
      expect(await audits()).toHaveLength(before);
    } finally {
      fault = undefined;
    }
  });

  it("retains the original amount after refund and invoice cancellation", async () => {
    const returned = await refund(h, clinic.admin.cookie, payment.invoiceId, {
      source: "payment",
      paymentId: payment.id,
      amountMinor: "1000",
      method: "knet",
      reason: "Synthetic refund",
    });
    expect(returned.statusCode, returned.body).toBe(201);
    expect((await open()).statusCode).toBe(200);
    expect(seen.at(-1)?.amountMinor).toBe("4000");
    const cancelled = await voidInvoice(h, clinic.admin.cookie, payment.invoiceId);
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect((await open()).statusCode).toBe(200);
    expect(seen.at(-1)?.amountMinor).toBe("4000");
  });

  it("keeps the default renderer unavailable without auditing an open", async () => {
    const before = (await audits()).length;
    const disabled = new UnavailableReceiptPdf();
    await disabled.render().catch((error: unknown) => {
      fault = error as Error;
    });
    try {
      expect((await open()).statusCode).toBe(503);
      expect(await audits()).toHaveLength(before);
    } finally {
      fault = undefined;
    }
  });

  it.each(["membership", "role", "permission", "branch", "module", "suspended", "expired"])(
    "revalidates %s after rendering without relying on the authorization cache",
    async (kind) => {
      const before = (await audits()).length;
      beforeReturn = async () => {
        if (kind === "membership")
          await h.owner`UPDATE memberships SET status = 'deactivated' WHERE id = ${viewer.memberId}`;
        if (kind === "role") await h.owner`UPDATE roles SET is_active = false WHERE id = ${role}`;
        if (kind === "permission")
          await h.owner`DELETE FROM role_permissions WHERE role_id = ${role}`;
        if (kind === "branch")
          await h.owner`DELETE FROM membership_branches WHERE membership_id = ${viewer.memberId}`;
        if (kind === "module")
          await h.owner`UPDATE clinic_features SET enabled = false WHERE clinic_id = ${clinic.clinicId} AND module = 'finance'`;
        if (kind === "suspended")
          await h.owner`UPDATE clinics SET status = 'suspended' WHERE id = ${clinic.clinicId}`;
        if (kind === "expired")
          await h.owner`UPDATE clinics SET expires_at = '2000-01-01' WHERE id = ${clinic.clinicId}`;
      };
      try {
        const response = await open();
        expect(response.statusCode, response.body).toBe(
          kind === "membership" ? 401 : kind === "branch" ? 404 : 403,
        );
        expect(response.headers["content-type"]).not.toBe("application/pdf");
        expect(await audits()).toHaveLength(before);
      } finally {
        beforeReturn = undefined;
        await h.owner`UPDATE memberships SET status = 'active' WHERE id = ${viewer.memberId}`;
        await h.owner`UPDATE roles SET is_active = true WHERE id = ${role}`;
        if (kind === "permission")
          await h.owner`INSERT INTO role_permissions (clinic_id, id, role_id, permission_id, created_at)
          SELECT ${clinic.clinicId}, ${randomUUID()}, ${role}, id, now() FROM permissions WHERE key = 'view:payments:branch'`;
        if (kind === "branch")
          await h.owner`INSERT INTO membership_branches (clinic_id, id, membership_id, branch_id, created_at) VALUES (${clinic.clinicId}, ${randomUUID()}, ${viewer.memberId}, ${clinic.branchD}, now())`;
        await h.owner`UPDATE clinic_features SET enabled = true WHERE clinic_id = ${clinic.clinicId} AND module = 'finance'`;
        await h.owner`UPDATE clinics SET status = 'active', expires_at = '2099-01-01' WHERE id = ${clinic.clinicId}`;
      }
    },
  );
});
