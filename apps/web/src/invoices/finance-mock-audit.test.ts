import { beforeEach, describe, expect, it } from "vitest";
import type { CreateInvoiceRequest } from "@eyadex/contracts/finance";
import { as, api, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import {
  assertInvoiceAuditSnapshotShape,
  invoiceAuditSnapshot,
  type InvoiceAuditSnapshot,
} from "@eyadex/contracts/finance-audit-snapshot";
import { arAudit } from "@/shared/i18n/ar-audit";
import { enAudit } from "@/shared/i18n/en-audit";

const admin = () => as("clinic_admin");
const rows = (action: string) =>
  getState().clinicAudit.filter((r) => r.clinicId === clinicIdAt(0) && r.action === action);

function manual(amount: string): CreateInvoiceRequest {
  const patient = getState().patients.find((p) => p.clinicId === clinicIdAt(0));
  if (!patient) throw new Error("seed");
  return {
    source: "manual",
    sourceId: null,
    patientId: patient.id,
    branchId: patient.registrationBranchId,
    lines: [
      {
        kind: "free",
        descriptionAr: "بند",
        descriptionEn: "Item",
        quantity: 1,
        unitPriceMinor: amount,
        discount: null,
      },
    ],
    invoiceDiscount: null,
  };
}

const serviceId = () => {
  const s = getState().services.find((x) => x.clinicId === clinicIdAt(0));
  if (!s) throw new Error("seed");
  return s.id;
};

beforeEach(() => resetMockData());

describe("mock finance audit rows, as the API", () => {
  it("labels every finance write snapshot field in Arabic and English", async () => {
    await api.finance.setServicePrice(admin(), serviceId(), "2500");
    await api.finance.setProviderPrices(admin(), serviceId(), []);
    await api.finance.updateSettings(admin(), "CR-1");
    const [prefix] = await api.finance.prefixes(admin());
    await api.finance.setPrefix(admin(), prefix!.branchId, "NEWP");
    await api.finance.updatePlatformFinance(as("platform_admin"), clinicIdAt(0), {
      taxRateBp: 100,
    });
    const body = manual("5000");
    body.lines[0]!.discount = { kind: "pct", bp: 100, reason: "staff" };
    body.invoiceDiscount = { kind: "amount", minor: "10", reason: "staff" };
    const invoice = await api.finance.issue(admin(), body, crypto.randomUUID());
    await api.finance.edit(admin(), invoice.id, 1, {
      lines: manual("7000").lines,
      invoiceDiscount: null,
    });
    await api.finance.voidInvoice(admin(), invoice.id, 2, "issued twice");
    const keys = new Set<string>();
    const collect = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
          keys.add(key);
          collect(nested);
        }
      }
    };
    collect(invoiceAuditSnapshot(invoice));
    for (const row of [...getState().clinicAudit, ...getState().platformAudit]) {
      collect(row.before);
      collect(row.after);
    }
    // API finance writes also carry field names only, a provider count, or access metadata.
    for (const key of [
      "changed",
      "priceMinor",
      "commercialRegNo",
      "logo",
      "providerCount",
      "reasonLength",
      "via",
    ])
      keys.add(key);
    for (const key of keys) {
      for (const dict of [arAudit, enAudit]) {
        expect((dict.audit.fields as Record<string, string>)[key], key).toBeTruthy();
      }
    }
    expect(arAudit.audit.fields.invoicePrefix).toBe("بادئة الفاتورة");
    expect(enAudit.audit.fields.invoicePrefix).toBe("Invoice prefix");
  });

  it("records issue, edit and void with exact invoice snapshots (patient access)", async () => {
    const privateText = "private invoice text";
    const request = manual("5000");
    request.lines[0]!.discount = { kind: "pct", bp: 100, reason: privateText };
    request.invoiceDiscount = { kind: "amount", minor: "10", reason: privateText };
    const inv = await api.finance.issue(admin(), request, crypto.randomUUID());
    const [issued] = rows("invoice.issued");
    expect(issued).toMatchObject({
      entity: "invoice",
      entityId: inv.id,
      category: "patient_access",
    });
    expect(issued?.before).toBeNull();
    expect(issued?.after).toMatchObject({
      number: inv.number,
      totalMinor: inv.totalMinor,
      version: 1,
    });
    const body = { lines: manual("7000").lines, invoiceDiscount: null };
    const edited = await api.finance.edit(admin(), inv.id, 1, body);
    expect(rows("invoice.edited")[0]?.before).toMatchObject({ version: 1 });
    expect(rows("invoice.edited")[0]?.after).toMatchObject({ version: 2 });
    const result = await api.finance.voidInvoice(admin(), inv.id, 2, "سبب طويل نصي");
    const voided = rows("invoice.voided")[0];
    expect(voided?.after).toMatchObject({ status: "void" });
    expect(JSON.stringify(voided)).not.toContain("سبب طويل");
    const snapshots = [
      [issued?.after, inv],
      [rows("invoice.edited")[0]?.before, inv],
      [rows("invoice.edited")[0]?.after, edited],
      [voided?.before, edited],
      [voided?.after, result],
    ] as const;
    for (const [snapshot, invoice] of snapshots) {
      expect(snapshot).toEqual(invoiceAuditSnapshot(invoice));
      expect(JSON.stringify(snapshot)).not.toContain(privateText);
      expect(Object.keys(snapshot ?? {}).sort()).toEqual([
        "discountMinor",
        "discounts",
        "lineCount",
        "number",
        "status",
        "subtotalMinor",
        "taxMinor",
        "totalMinor",
        "version",
      ]);
      expect(() =>
        assertInvoiceAuditSnapshotShape(snapshot as unknown as InvoiceAuditSnapshot),
      ).not.toThrow();
    }
  });

  it("does not scrub a 7+ digit amount or the invoice number in the snapshot", async () => {
    const inv = await api.finance.issue(admin(), manual("12345678"), crypto.randomUUID());
    const after = rows("invoice.issued")[0]?.after;
    expect(after?.["subtotalMinor"]).toBe("12345678");
    expect(after?.["number"]).toBe(inv.number);
  });

  it("records price, provider prices, commercial registration and prefix writes", async () => {
    await api.finance.setServicePrice(admin(), serviceId(), "2500");
    await api.finance.setProviderPrices(admin(), serviceId(), []);
    await api.finance.updateSettings(admin(), "CR-1");
    expect(rows("service.price_set")[0]).toMatchObject({
      entity: "clinic_service",
      category: "administrative",
    });
    expect(rows("service.provider_prices_set")).toHaveLength(1);
    expect(rows("clinic.commercial_reg_no_set")).toHaveLength(1);
    const items = await api.finance.prefixes(admin());
    const free = items.find((i) => !i.locked) ?? items[0];
    await api.finance.setPrefix(admin(), free?.branchId ?? "", "NEWP");
    expect(rows("branch.invoice_prefix_set")[0]?.after).toEqual({ invoicePrefix: "NEWP" });
  });

  it("NEGATIVE: a refused write leaves no audit row", async () => {
    await api.finance.setServicePrice(as("doctor"), serviceId(), "2500").catch(() => null);
    await api.finance.issue(admin(), manual("-1"), crypto.randomUUID()).catch(() => null);
    expect(rows("service.price_set")).toHaveLength(0);
    expect(rows("invoice.issued")).toHaveLength(0);
  });
});

describe("opening the invoice PDF", () => {
  it("writes one invoice.pdf_opened row with no snapshot", async () => {
    expect.assertions(2);
    const inv = await api.finance.issue(admin(), manual("5000"), crypto.randomUUID());
    await api.finance.pdf(admin(), inv.id);
    const opened = rows("invoice.pdf_opened");
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      action: "invoice.pdf_opened",
      entityId: inv.id,
      before: null,
      after: null,
    });
  });
});
