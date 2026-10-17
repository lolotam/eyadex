import { beforeEach, describe, expect, it } from "vitest";
import { errorCodeOf } from "@/shared/api/api-error";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";

// PR #78 review (R1-14), as the API: the discount key guards discounts and the lines they sit on, not
// undiscounted lines. The seeded front desk edits invoices but holds no discount key.
const fails = async (p: Promise<unknown>) =>
  errorCodeOf(
    await p.then(
      () => null,
      (e) => e,
    ),
  );

const line = (unitPriceMinor: string, discount: unknown = null) => ({
  kind: "free" as const,
  descriptionAr: "بند",
  descriptionEn: "Item",
  quantity: 1,
  unitPriceMinor,
  discount: discount as null,
});
const pct = { kind: "pct", bp: 1000, reason: "courtesy" };

async function deskInvoice(lines: ReturnType<typeof line>[]) {
  const db = getState();
  const role = db.roles.find((r) => r.clinicId === clinicIdAt(0) && r.systemKey === "receptionist");
  const desk = db.members.find((m) => m.roleId === role?.id && m.status === "active");
  const patient = db.patients.find(
    (p) => p.clinicId === clinicIdAt(0) && desk?.branchIds.includes(p.registrationBranchId),
  );
  if (!patient) throw new Error("seed");
  const body = {
    source: "manual" as const,
    sourceId: null,
    patientId: patient.id,
    branchId: patient.registrationBranchId,
    lines,
    invoiceDiscount: null,
  };
  return api.finance.issue(as("clinic_admin"), body, crypto.randomUUID());
}

beforeEach(() => resetMockData());

describe("invoice edits by a member without the discount key", () => {
  it("adds and removes an undiscounted line", async () => {
    const inv = await deskInvoice([line("1000")]);
    const desk = as("receptionist");
    const added = await api.finance.edit(desk, inv.id, 1, {
      lines: [line("1000"), line("200")],
      invoiceDiscount: null,
    });
    expect(added.lines).toHaveLength(2);
    const removed = await api.finance.edit(desk, inv.id, 2, {
      lines: [line("1000")],
      invoiceDiscount: null,
    });
    expect(removed.lines).toHaveLength(1);
  });

  it("NEGATIVE: cannot move a discount between two identical lines", async () => {
    const inv = await deskInvoice([line("1000", pct), line("1000")]);
    const moved = { lines: [line("1000"), line("1000", pct)], invoiceDiscount: null };
    expect(await fails(api.finance.edit(as("receptionist"), inv.id, 1, moved))).toBe("forbidden");
  });

  it("NEGATIVE: cannot move a discount onto another line", async () => {
    const inv = await deskInvoice([line("1000", pct), line("5000")]);
    const moved = { lines: [line("1000"), line("5000", pct)], invoiceDiscount: null };
    expect(await fails(api.finance.edit(as("receptionist"), inv.id, 1, moved))).toBe("forbidden");
  });
});
