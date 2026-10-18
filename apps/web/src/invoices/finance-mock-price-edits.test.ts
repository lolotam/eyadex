import { beforeEach, describe, expect, it } from "vitest";
import type { InvoiceLineInput } from "@eyadex/contracts/finance";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";

beforeEach(() => resetMockData());

async function issuedThenUnpriced() {
  const admin = as("clinic_admin");
  const db = getState();
  const patient = db.patients.find((p) => p.clinicId === clinicIdAt(0));
  const service = db.services.find((s) => s.clinicId === clinicIdAt(0));
  if (!patient || !service) throw new Error("seed");
  await api.finance.setServicePrice(admin, service.id, "1000");
  const serviceLine: Extract<InvoiceLineInput, { kind: "service" }> = {
    kind: "service",
    serviceId: service.id,
    providerId: null,
    quantity: 1,
    unitPriceMinor: "1000",
    discount: { kind: "pct", bp: 1000, reason: "courtesy" },
  };
  const freeLine: InvoiceLineInput = {
    kind: "free",
    descriptionAr: "بند",
    descriptionEn: "Item",
    quantity: 1,
    unitPriceMinor: "200",
    discount: null,
  };
  const invoice = await api.finance.issue(
    admin,
    {
      source: "manual",
      sourceId: null,
      patientId: patient.id,
      branchId: patient.registrationBranchId,
      lines: [serviceLine, freeLine],
      invoiceDiscount: null,
    },
    crypto.randomUUID(),
  );
  await api.finance.setServicePrice(admin, service.id, null);
  return { admin, invoice, serviceLine, freeLine };
}

describe("editing invoices after clearing a service price", () => {
  it("keeps an unchanged service line while editing another line, including after reordering", async () => {
    const { admin, invoice, serviceLine, freeLine } = await issuedThenUnpriced();
    const edited = await api.finance.edit(admin, invoice.id, invoice.version, {
      lines: [{ ...freeLine, unitPriceMinor: "300" }, serviceLine],
      invoiceDiscount: null,
    });
    expect(edited.version).toBe(invoice.version + 1);
    expect(edited.lines[1]).toMatchObject(serviceLine);
    expect(edited.lines[0]?.unitPriceMinor).toBe("300");
  });

  it.each([
    { quantity: 2 },
    { unitPriceMinor: "1200" },
    { providerId: "0198f0a0-0000-7000-8000-000000000001" },
    { discount: { kind: "pct" as const, bp: 500, reason: "courtesy" } },
    { discount: { kind: "pct" as const, bp: 1000, reason: "different reason" } },
    { discount: { kind: "amount" as const, minor: "100", reason: "courtesy" } },
  ])("requires a current price when the service line changes: %j", async (change) => {
    const { admin, invoice, serviceLine, freeLine } = await issuedThenUnpriced();
    await expect(
      api.finance.edit(admin, invoice.id, invoice.version, {
        lines: [{ ...serviceLine, ...change }, freeLine],
        invoiceDiscount: null,
      }),
    ).rejects.toMatchObject({ code: "price_missing" });
  });

  it("exempts only one matching copy per stored line", async () => {
    const { admin, invoice, serviceLine } = await issuedThenUnpriced();
    await expect(
      api.finance.edit(admin, invoice.id, invoice.version, {
        lines: [serviceLine, serviceLine],
        invoiceDiscount: null,
      }),
    ).rejects.toMatchObject({ code: "price_missing" });
  });
});
