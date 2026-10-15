import { randomUUID } from "node:crypto";

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
  financeClinic,
  manualInvoice,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// Plan Task 9 (FIN-5, spec §8 rule 15, R2-5): «ابعت» queues one `invoice` ledger row per press, keyed by the
// client's sendRequestId; the worker mints the link and sends it.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;

const press = (cookie: string, invoiceId: string, channel: string, sendRequestId: string) =>
  send(h, cookie, "POST", `/v1/invoices/${invoiceId}/send`, { channel, sendRequestId });
const rowsOf = (invoiceId: string) =>
  h.owner`SELECT id, kind, channel, status, subject_type, subject_at, send_request_id, requested_by,
                 patient_id
          FROM patient_notifications WHERE clinic_id = ${C.clinicId} AND subject_id = ${invoiceId}
          ORDER BY created_at, id`;
const eventsOf = (notificationId: string) =>
  h.owner`SELECT payload FROM outbox_events
          WHERE clinic_id = ${C.clinicId} AND event_type = 'patient.notification_requested'
            AND payload->>'notificationId' = ${notificationId}`;

async function invoiceOnD() {
  const patient = await patientIn(h, C, C.branchD);
  const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD);
  return { ...invoice, patient };
}

beforeAll(async () => {
  h = await openHarness({}, true);
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
});

afterAll(() => closeHarness(h));

describe("POST /v1/invoices/:id/send (R2-5)", () => {
  it("queues one invoice row and an event that carries its id only", async () => {
    const invoice = await invoiceOnD();
    const sendRequestId = randomUUID();
    const res = await press(C.admin.cookie, invoice.id, "email", sendRequestId);
    expect(res.statusCode).toBe(200);
    const { notificationId } = res.json() as { notificationId: string };
    expect(await rowsOf(invoice.id)).toEqual([
      {
        id: notificationId,
        kind: "invoice",
        channel: "email",
        status: "queued",
        subject_type: "invoice",
        subject_at: null,
        send_request_id: sendRequestId,
        requested_by: C.admin.memberId,
        patient_id: invoice.patient,
      },
    ]);
    expect((await eventsOf(notificationId)).map((e) => e["payload"])).toEqual([{ notificationId }]);
  });

  it("a new press queues another row; a retried press answers with the first row", async () => {
    const invoice = await invoiceOnD();
    const first = randomUUID();
    const a = await press(C.admin.cookie, invoice.id, "whatsapp", first);
    const retry = await press(C.admin.cookie, invoice.id, "whatsapp", first);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(a.json());
    const again = await press(C.admin.cookie, invoice.id, "whatsapp", randomUUID());
    expect(again.statusCode).toBe(200);
    const rows = await rowsOf(invoice.id);
    expect(rows.map((r) => r["id"])).toEqual([
      (a.json() as { notificationId: string }).notificationId,
      (again.json() as { notificationId: string }).notificationId,
    ]);
    const firstId = (a.json() as { notificationId: string }).notificationId;
    expect(await eventsOf(firstId)).toHaveLength(1);
  });

  it("the same sendRequestId with another invoice or channel is send_request_conflict and writes nothing", async () => {
    const one = await invoiceOnD();
    const other = await invoiceOnD();
    const id = randomUUID();
    expect((await press(C.admin.cookie, one.id, "email", id)).statusCode).toBe(200);
    const otherInvoice = await press(C.admin.cookie, other.id, "email", id);
    const otherChannel = await press(C.admin.cookie, one.id, "whatsapp", id);
    for (const res of [otherInvoice, otherChannel]) {
      expect([res.statusCode, code(res)]).toEqual([400, "send_request_conflict"]);
    }
    expect(await rowsOf(other.id)).toEqual([]);
    expect(await rowsOf(one.id)).toHaveLength(1);
  });

  it("a void invoice is invoice_void and queues nothing", async () => {
    const invoice = await invoiceOnD();
    const voided = await h.owner`UPDATE invoices SET status = 'void', void_reason = 'test',
                                   voided_at = now() WHERE id = ${invoice.id} RETURNING id`;
    expect(voided).toHaveLength(1);
    const res = await press(C.admin.cookie, invoice.id, "email", randomUUID());
    expect([res.statusCode, code(res)]).toEqual([409, "invoice_void"]);
    expect(await rowsOf(invoice.id)).toEqual([]);
  });

  it("an invoice outside the caller's view reach is not_found", async () => {
    // The desk sees branch R only; the invoice is on branch D.
    const invoice = await invoiceOnD();
    const res = await press(C.desk.cookie, invoice.id, "email", randomUUID());
    expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
    expect(await rowsOf(invoice.id)).toEqual([]);
  });
});

// Plan Task 8g is postponed to the end of the project (owner, 2026-10-16): until then a PDF answers 503.
describe("before the server PDF exists", () => {
  it("GET /v1/invoices/:id/pdf answers 503", async () => {
    const invoice = await invoiceOnD();
    const res = await send(h, C.admin.cookie, "GET", `/v1/invoices/${invoice.id}/pdf`);
    expect(res.statusCode).toBe(503);
  });
});
