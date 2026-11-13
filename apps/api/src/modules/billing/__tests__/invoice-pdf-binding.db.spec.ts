import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@eyadex/db";
import { MemoryBlobStore } from "../../../shared/blob/memory-blob-store.ts";
import { DATABASE } from "../../../shared/database.provider.ts";
import {
  APP,
  call,
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import { PgBillingPdfHeader } from "../../tenancy/index.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import type { InvoicePdfModel } from "../domain/invoice-pdf-model.ts";
import { PdfProcessError } from "../rendering/pdf-process.ts";
import {
  financeClinic,
  manualInvoice,
  namedPatient,
  setPrefixes,
  type FinanceClinic,
} from "./billing-fixtures.ts";

let h: Harness, clinic: FinanceClinic, invoice: { id: string; number: string }, db: Database;
const blobs = new MemoryBlobStore();
const seen: { model: InvoicePdfModel; logo: Buffer | null }[] = [];
let fault: Error | null = null;
const pdf = Buffer.from("%PDF-synthetic-boundary");
const open = (cookie = clinic.admin.cookie) =>
  send(h, cookie, "GET", `/v1/invoices/${invoice.id}/pdf`);
const audits = () => h.owner`SELECT id FROM audit_log WHERE clinic_id = ${clinic.clinicId}
  AND entity_id = ${invoice.id} AND action = 'invoice.pdf_opened'`;

beforeAll(async () => {
  h = await openHarness({}, true, {
    blobStore: blobs,
    invoicePdfModel: {
      render: async (model, loadLogo) => {
        const logo = (await loadLogo?.()) ?? null;
        if (fault) throw fault;
        seen.push({ model, logo });
        return pdf;
      },
    },
  });
  const invalidator = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  db = h.app.get<Database>(DATABASE);
  clinic = await financeClinic(h, invalidator);
  await setPrefixes(h, clinic);
  const patient = await namedPatient(h, clinic, clinic.branchD, "مراجع تجريبي للفاتورة");
  invoice = await manualInvoice(h, clinic.admin.cookie, patient, clinic.branchD);
  await h.owner`UPDATE branches SET address = 'SYNTHETIC ADDRESS' WHERE clinic_id = ${clinic.clinicId} AND id = ${clinic.branchD}`;
  await h.owner`UPDATE clinics SET commercial_reg_no = 'SYN-CR' WHERE id = ${clinic.clinicId}`;
});
afterAll(() => closeHarness(h));

describe("invoice PDF data binding", () => {
  it("passes only the allowlisted stored model through the authenticated route", async () => {
    const response = await open();
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(pdf);
    const model = seen.at(-1)!.model;
    expect(model.patientName).toBe("مراجع تجريبي للفاتورة");
    expect(model.number).toBe(invoice.number);
    expect(model.header).toContainEqual({ ar: "SYNTHETIC ADDRESS", en: "SYNTHETIC ADDRESS" });
    expect(model.header).toContainEqual({ ar: "SYN-CR", en: "SYN-CR" });
    expect(JSON.stringify(model)).not.toContain(clinic.clinicId);
    expect(JSON.stringify(model)).not.toContain(invoice.id);
    expect(await audits()).toHaveLength(1);
  });

  it("keeps header reads within the clinic RLS context", async () => {
    const headers = new PgBillingPdfHeader();
    expect(
      await db.withTenant(clinic.clinicId, (tx) => headers.read(tx, randomUUID(), clinic.branchD)),
    ).toBeNull();
    expect(
      await db.withTenant(randomUUID(), (tx) => headers.read(tx, clinic.clinicId, clinic.branchD)),
    ).toBeNull();
  });

  it("rejects an unauthorized actor before loading or rendering patient data", async () => {
    const count = seen.length;
    expect((await open(clinic.priceReader.cookie)).statusCode).toBe(403);
    expect(seen).toHaveLength(count);
  });

  it("loads the private clinic logo separately without adding its key to the model", async () => {
    const logo = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const key = `clinic/${clinic.clinicId}/${randomUUID()}`;
    await blobs.put(key, logo);
    await h.owner`UPDATE clinics SET logo_blob_key = ${key} WHERE id = ${clinic.clinicId}`;
    expect((await open()).statusCode).toBe(200);
    expect(seen.at(-1)!.logo).toEqual(logo);
    expect(JSON.stringify(seen.at(-1)!.model)).not.toContain(key);
    await h.owner`UPDATE clinics SET logo_blob_key = NULL WHERE id = ${clinic.clinicId}`;
  });

  it("returns a typed busy refusal and Retry-After without recording an open", async () => {
    const before = (await audits()).length;
    fault = new PdfProcessError("pdf_busy");
    try {
      const response = await open();
      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe("pdf_busy");
      expect(response.headers["retry-after"]).toBe("2");
      expect(await audits()).toHaveLength(before);
    } finally {
      fault = null;
    }
  });

  it.each(["missing", "invalid", "oversized"])(
    "refuses a %s logo without returning a partial PDF",
    async (kind) => {
      const key = `clinic/${clinic.clinicId}/${randomUUID()}`;
      if (kind !== "missing")
        await blobs.put(
          key,
          kind === "invalid"
            ? Buffer.from("invalid")
            : Buffer.concat([
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
                Buffer.alloc(1024 * 1024),
              ]),
        );
      await h.owner`UPDATE clinics SET logo_blob_key = ${key} WHERE id = ${clinic.clinicId}`;
      const before = (await audits()).length;
      try {
        const response = await open();
        expect(response.statusCode).toBe(503);
        expect(response.json().code).toBe("pdf_render_failed");
        expect(await audits()).toHaveLength(before);
        expect(response.body + h.logs.join("\n")).not.toContain(key);
      } finally {
        await h.owner`UPDATE clinics SET logo_blob_key = NULL WHERE id = ${clinic.clinicId}`;
      }
    },
  );

  it("does not expose renderer exception text in the response or logs", async () => {
    fault = new Error("SYNTHETIC-PRIVATE-RENDER-TEXT");
    try {
      const response = await open();
      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe("pdf_render_failed");
      expect(response.body + h.logs.join("\n")).not.toContain(fault.message);
    } finally {
      fault = null;
    }
  });

  it("uses the same model binding for an authorized public invoice link", async () => {
    const sent = await send(h, clinic.admin.cookie, "POST", `/v1/invoices/${invoice.id}/send`, {
      channel: "email",
      sendRequestId: randomUUID(),
    });
    expect(sent.statusCode).toBe(200);
    const token = randomBytes(32);
    await h.owner`INSERT INTO invoice_links (clinic_id,id,invoice_id,notification_id,token_hash,token_sealed,expires_at,created_at)
      VALUES (${clinic.clinicId},${randomUUID()},${invoice.id},${sent.json().notificationId},
        ${createHash("sha256").update(token).digest()},'v1.synthetic',${new Date(Date.now() + 60_000)},now())`;
    const response = await call(h, {
      method: "GET",
      host: APP,
      url: `/v1/public/invoices/${token.toString("base64url")}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(pdf);
    expect(seen.at(-1)!.model.number).toBe(invoice.number);
  });
});
