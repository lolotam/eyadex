import { createHash, randomBytes, randomUUID } from "node:crypto";

import { SYSTEM_ACTOR_ID } from "@eyadex/contracts/audit";
import type { Invoice } from "@eyadex/contracts/finance";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  APP,
  call,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { code, send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import { patientIn } from "../../medical/__tests__/medical-fixtures.ts";
import type { InvoicePdfRenderer } from "../index.ts";
import {
  financeClinic,
  manualInvoice,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

// Plan Task 9 (spec §8 rule 16, R2-7): the patient's link, without a session. The renderer is a fake until
// plan Task 8g; what is asserted is that it gets the invoice as it stands now.
let h: Harness;
let C: FinanceClinic;
let invalidate: AuthorizationInvalidator;
const PDF = new TextEncoder().encode("%PDF-fake");
const rendered: { clinicId: string; invoice: Invoice }[] = [];
// What happens elsewhere while the file is being made (a void, say); reset after each use.
let duringRender: ((invoice: Invoice) => Promise<void>) | null = null;
const renderer: InvoicePdfRenderer = {
  render: async (clinicId, invoice) => {
    rendered.push({ clinicId, invoice });
    await duringRender?.(invoice);
    return PDF;
  },
};

const open = (token: string, host = APP) =>
  call(h, { method: "GET", url: `/v1/public/invoices/${token}`, host });

/** An issued invoice, one press of «ابعت» on it, and the link the worker would mint for that press. */
async function linked(o: { expiresInMs?: number } = {}) {
  const patient = await patientIn(h, C, C.branchD);
  const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD);
  const pressed = await send(h, C.admin.cookie, "POST", `/v1/invoices/${invoice.id}/send`, {
    channel: "email",
    sendRequestId: randomUUID(),
  });
  const { notificationId } = pressed.json() as { notificationId: string };
  const bytes = randomBytes(32);
  const linkId = randomUUID();
  const expires = new Date(Date.now() + (o.expiresInMs ?? 86_400_000));
  await h.owner`INSERT INTO invoice_links (clinic_id, id, invoice_id, notification_id, token_hash,
                  token_sealed, expires_at, revoked_at, created_at)
                VALUES (${C.clinicId}, ${linkId}, ${invoice.id}, ${notificationId},
                  ${createHash("sha256").update(bytes).digest()}, 'v1.sealed-by-the-worker',
                  ${expires}, NULL, now())`;
  return { invoice, linkId, token: bytes.toString("base64url") };
}

beforeAll(async () => {
  h = await openHarness({}, true, { invoicePdf: renderer });
  invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await financeClinic(h, invalidate);
  await setPrefixes(h, C);
});

afterAll(() => closeHarness(h));

describe("GET /v1/public/invoices/:token (R1-16, R2-7)", () => {
  it("a live link answers the latest version as a PDF and is audited as a patient-link view", async () => {
    const { invoice, linkId, token } = await linked();
    await h.owner`UPDATE invoices SET version = version + 1 WHERE id = ${invoice.id}`;
    const res = await open(token);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(new Uint8Array(res.rawPayload)).toEqual(PDF);
    expect(rendered.at(-1)).toMatchObject({
      clinicId: C.clinicId,
      invoice: { id: invoice.id, number: invoice.number, version: 2 },
    });
    const audit = await h.owner`SELECT actor_user_id, action, category, entity_type, details
                                FROM audit_log WHERE clinic_id = ${C.clinicId} AND entity_id = ${linkId}`;
    expect(audit).toEqual([
      {
        actor_user_id: SYSTEM_ACTOR_ID,
        action: "invoice.link_opened",
        category: "patient_access",
        entity_type: "invoice_link",
        details: { before: null, after: null, via: "patient_link" },
      },
    ]);
    expect(h.logs.join("\n")).not.toContain(token);
  });

  it("unknown, malformed, expired and revoked links are all invoice_link_expired", async () => {
    const expired = await linked({ expiresInMs: -1000 });
    const revoked = await linked();
    await h.owner`UPDATE invoice_links SET revoked_at = now() WHERE id = ${revoked.linkId}`;
    const before = rendered.length;
    for (const token of [
      randomBytes(32).toString("base64url"),
      "not-a-token",
      expired.token,
      revoked.token,
    ]) {
      const res = await open(token);
      expect([res.statusCode, code(res)]).toEqual([404, "invoice_link_expired"]);
    }
    expect(rendered.length).toBe(before);
  });

  it("voiding the invoice revokes its links (spec §8 rule 16)", async () => {
    const { invoice, token } = await linked();
    const voided = await call(h, {
      method: "POST",
      url: `/v1/invoices/${invoice.id}/void`,
      host: APP,
      cookie: C.admin.cookie,
      body: { reason: "issued twice" },
      headers: { "if-match": '"1"' },
    });
    expect(voided.statusCode).toBe(200);
    const res = await open(token);
    expect([res.statusCode, code(res)]).toEqual([404, "invoice_link_expired"]);
    const links =
      await h.owner`SELECT revoked_at FROM invoice_links WHERE invoice_id = ${invoice.id}`;
    expect(links.map((l) => l["revoked_at"] !== null)).toEqual([true]);
  });

  // PR #78 review: the link is judged again once the file exists, so a void during the render wins.
  it("a void that commits during the render answers invoice_link_expired and audits no open", async () => {
    const { linkId, token } = await linked();
    duringRender = async (invoice) => {
      const voided = await call(h, {
        method: "POST",
        url: `/v1/invoices/${invoice.id}/void`,
        host: APP,
        cookie: C.admin.cookie,
        body: { reason: "issued twice" },
        headers: { "if-match": `"${invoice.version}"` },
      });
      expect(voided.statusCode).toBe(200);
    };
    const res = await open(token).finally(() => (duringRender = null));
    expect([res.statusCode, code(res)]).toEqual([404, "invoice_link_expired"]);
    const audit = await h.owner`SELECT id FROM audit_log
                                WHERE clinic_id = ${C.clinicId} AND entity_id = ${linkId}`;
    expect(audit).toEqual([]);
  });

  it("the platform host does not serve it", async () => {
    const { token } = await linked();
    const res = await open(token, PLATFORM);
    expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
  });
});

describe("GET /v1/invoices/:id/pdf (spec §3.3)", () => {
  it("renders the invoice for a member who can see it, as an inline PDF, and audits the open", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD);
    const res = await send(h, C.admin.cookie, "GET", `/v1/invoices/${invoice.id}/pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe(`inline; filename="${invoice.number}.pdf"`);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(new Uint8Array(res.rawPayload)).toEqual(PDF);
    expect(rendered.at(-1)).toMatchObject({ invoice: { id: invoice.id } });
    const audit = await h.owner`SELECT actor_user_id, category FROM audit_log
                                WHERE entity_id = ${invoice.id} AND action = 'invoice.pdf_opened'`;
    expect(audit).toEqual([{ actor_user_id: C.admin.userId, category: "patient_access" }]);
  });

  it("is not_found for a member whose reach misses the invoice", async () => {
    const patient = await patientIn(h, C, C.branchD);
    const invoice = await manualInvoice(h, C.admin.cookie, patient, C.branchD);
    const res = await send(h, C.desk.cookie, "GET", `/v1/invoices/${invoice.id}/pdf`);
    expect([res.statusCode, code(res)]).toEqual([404, "not_found"]);
  });
});
