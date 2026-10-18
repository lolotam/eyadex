import { beforeEach, describe, expect, it } from "vitest";
import type { CreateInvoiceRequest } from "@eyadex/contracts/finance";
import { as, api, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";

beforeEach(() => resetMockData());

function manual(): CreateInvoiceRequest {
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
        unitPriceMinor: "5000",
        discount: null,
      },
    ],
    invoiceDiscount: null,
  };
}

describe("the invoice detail's patient name", () => {
  it("comes with the detail and writes no patient-access row", async () => {
    const body = manual();
    const issued = await api.finance.issue(as("clinic_admin"), body, crypto.randomUUID());
    const rows = getState().clinicAudit.length;
    const detail = await api.finance.getInvoice(as("clinic_admin"), issued.id);
    const patient = getState().patients.find((p) => p.id === body.patientId);
    expect(detail.patientName).toBe(patient?.fullName);
    expect(getState().clinicAudit.length).toBe(rows);
  });

  it("list rows never carry it", async () => {
    await api.finance.issue(as("clinic_admin"), manual(), crypto.randomUUID());
    const page = await api.finance.listInvoices(as("clinic_admin"), { limit: 5 });
    expect(page.items.every((i) => !("patientName" in i))).toBe(true);
  });

  it("NEGATIVE: another clinic is refused, and no name leaks", async () => {
    const issued = await api.finance.issue(as("clinic_admin"), manual(), crypto.randomUUID());
    await expect(api.finance.getInvoice(as("clinic_admin", 1), issued.id)).rejects.toMatchObject({
      code: expect.stringMatching(/^(not_found|module_disabled)$/),
    });
  });
});
