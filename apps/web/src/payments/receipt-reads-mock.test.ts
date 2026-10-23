import { beforeEach, describe, expect, it } from "vitest";
import { branchOptionListResponseSchema } from "@eyadex/contracts/role-admin";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import {
  admin,
  api,
  as,
  clinicIdAt,
  clinicPatients,
  getState,
  issue,
  pay,
  refusal,
  roleOf,
} from "./payment-mock-kit";

beforeEach(() => resetMockData());

const twoBranches = () => {
  const a = clinicPatients()[0]!;
  const b = clinicPatients().find((p) => p.registrationBranchId !== a.registrationBranchId)!;
  return { a, b };
};

/** A front desk whose `view:payments:branch` reaches one branch only. */
function deskAt(branchId: string, keys = ["view:payments:branch"]) {
  const { role, member } = roleOf("receptionist");
  role.permissions = keys;
  member.allBranches = false;
  member.branchIds = [branchId];
  return as("receptionist");
}

describe("GET /payments/branch-options (card 1b)", () => {
  it("lists only the branches the view key reaches, in the contract's shape", async () => {
    const { a } = twoBranches();
    const all = await api.payments.branchOptions(admin(), {});
    expect(branchOptionListResponseSchema.safeParse(all).success).toBe(true);
    const clinicBranches = getState().branches.filter((b) => b.clinicId === clinicIdAt(0));
    expect(all.items.map((b) => b.id)).toEqual(clinicBranches.map((b) => b.id));
    const desk = deskAt(a.registrationBranchId);
    const mine = await api.payments.branchOptions(desk, {});
    expect(mine.items.map((b) => b.id)).toEqual([a.registrationBranchId]);
  });

  it("pages with the cursor", async () => {
    const first = await api.payments.branchOptions(admin(), { limit: 1 });
    expect(first.items).toHaveLength(1);
    const second = await api.payments.branchOptions(admin(), {
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
  });

  it("orders by id and uses the API's dash-free cursor", async () => {
    const all = await api.payments.branchOptions(admin(), {});
    const ids = all.items.map((b) => b.id);
    expect(ids).toEqual([...ids].sort());
    const first = await api.payments.branchOptions(admin(), { limit: 1 });
    expect(first.nextCursor).toBe(ids[0]!.replaceAll("-", ""));
  });

  it("NEGATIVE: a cursor not in the API's format is a validation error, not page one", async () => {
    const all = await api.payments.branchOptions(admin(), {});
    expect(
      await refusal(api.payments.branchOptions(admin(), { cursor: all.items[0]!.id })),
    ).toBe("validation");
  });

  it("NEGATIVE: without view:payments it is forbidden, as the other payment reads", async () => {
    const { role } = roleOf("receptionist");
    role.permissions = ["view:invoices:clinic", "create:payments:clinic"];
    expect(await refusal(api.payments.branchOptions(as("receptionist"), {}))).toBe("forbidden");
  });
});

describe("the receipts list and page reads", () => {
  it("filter by method and receipt number, and never write a patient-access row", async () => {
    const invoice = await issue("5000");
    await pay(invoice.id, "100", "cash");
    const knet = await pay(invoice.id, "200", "knet");
    const before = getState().clinicAudit.length;
    const byMethod = await api.payments.listPayments(admin(), { method: "knet" });
    expect(byMethod.items.map((p) => p.id)).toEqual([knet.payment.id]);
    const tail = knet.payment.receiptNumber.slice(-6).toLowerCase();
    const byNumber = await api.payments.listPayments(admin(), { receiptNumber: tail });
    expect(byNumber.items.map((p) => p.id)).toContain(knet.payment.id);
    const one = await api.payments.getPayment(admin(), knet.payment.id);
    expect(one.patientName).toBe(clinicPatients()[0]!.fullName);
    expect(getState().clinicAudit.length).toBe(before);
  });

  it("NEGATIVE: a branch-A desk never sees a branch-B receipt in the list or the page", async () => {
    const { a, b } = twoBranches();
    const invoice = await issue("5000", b);
    const paid = await pay(invoice.id, "100");
    const desk = deskAt(a.registrationBranchId);
    expect((await api.payments.listPayments(desk, {})).items).toEqual([]);
    expect(await refusal(api.payments.getPayment(desk, paid.payment.id))).toBe("not_found");
  });
});
