import { beforeEach, describe, expect, it } from "vitest";
import type { CreateInvoiceRequest } from "@eyadex/contracts/finance";
import { as, api, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";

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
  it("records issue, edit and void with exact invoice snapshots (patient access)", async () => {
    const inv = await api.finance.issue(admin(), manual("5000"), crypto.randomUUID());
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
    await api.finance.edit(admin(), inv.id, 1, body);
    expect(rows("invoice.edited")[0]?.before).toMatchObject({ version: 1 });
    expect(rows("invoice.edited")[0]?.after).toMatchObject({ version: 2 });
    await api.finance.voidInvoice(admin(), inv.id, 2, "سبب طويل نصي");
    const voided = rows("invoice.voided")[0];
    expect(voided?.after).toMatchObject({ status: "void" });
    expect(JSON.stringify(voided)).not.toContain("سبب طويل");
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
    const { api: client, as: who, getState: state } = await import(
      "@/shared/api/mock/mock-test-kit"
    );
    const page = await client.finance.listInvoices(who("clinic_admin"), { limit: 1 });
    const inv = page.items[0];
    if (!inv) return;
    await client.finance.pdf(who("clinic_admin"), inv.id);
    const row = state().clinicAudit[0];
    expect(row).toMatchObject({ action: "invoice.pdf_opened", entityId: inv.id, before: null, after: null });
  });
});
