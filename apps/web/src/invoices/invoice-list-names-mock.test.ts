import { beforeEach, describe, expect, it } from "vitest";
import type { CreateInvoiceRequest } from "@eyadex/contracts/finance";
import { invoiceListResponseSchema } from "@eyadex/contracts/finance";
import { ApiError, errorCodeOf } from "@/shared/api/api-error";
import { isOwnPatient } from "@/shared/api/mock/mock-own-scope";
import { as, api, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";

beforeEach(() => resetMockData());

const admin = () => as("clinic_admin");
const fails = async (p: Promise<unknown>) =>
  errorCodeOf(
    await p.then(
      () => null,
      (e) => e,
    ),
  );

function body(patientId: string, branchId: string): CreateInvoiceRequest {
  return {
    source: "manual",
    sourceId: null,
    patientId,
    branchId,
    lines: [
      {
        kind: "free",
        descriptionAr: "بند",
        descriptionEn: "Item",
        quantity: 1,
        unitPriceMinor: "1000",
        discount: null,
      },
    ],
    invoiceDiscount: null,
  };
}
const patients = () => getState().patients.filter((p) => p.clinicId === clinicIdAt(0));
const issueFor = (p: { id: string; registrationBranchId: string }) =>
  api.finance.issue(admin(), body(p.id, p.registrationBranchId), crypto.randomUUID());

function roleOf(kind: "receptionist" | "doctor") {
  const db = getState();
  const role = db.roles.find((r) => r.clinicId === clinicIdAt(0) && r.systemKey === kind);
  const member = db.members.find((m) => m.roleId === role?.id && m.status === "active");
  if (!role || !member) throw new Error("seed");
  return { role, member };
}

describe("patient names in the invoice list (mock = API)", () => {
  it("names every item correctly across two cursor pages and passes the contract", async () => {
    const [p1, p2] = patients();
    if (!p1 || !p2) throw new Error("seed");
    p1.fullName = "مراجع تجريبي أول";
    p2.fullName = "مراجع تجريبي ثان";
    await issueFor(p1);
    await issueFor(p2);
    const first = await api.finance.listInvoices(admin(), { limit: 1 });
    if (!first.nextCursor) throw new Error("two pages");
    const second = await api.finance.listInvoices(admin(), { limit: 1, cursor: first.nextCursor });
    for (const page of [first, second]) {
      expect(invoiceListResponseSchema.safeParse(page).success).toBe(true);
      for (const i of page.items) {
        const patient = getState().patients.find((p) => p.id === i.patientId);
        expect(i.patientName).toBe(patient?.fullName);
      }
    }
    const names = [...first.items, ...second.items].map((i) => i.patientName);
    expect(names.sort()).toEqual(["مراجع تجريبي أول", "مراجع تجريبي ثان"].sort());
  });

  it("NEGATIVE: a branch-A desk member never sees the name of a branch-B-only patient", async () => {
    const all = patients();
    const a = all[0];
    const b = all.find((p) => p.registrationBranchId !== a?.registrationBranchId);
    if (!a || !b) throw new Error("seed");
    a.fullName = "مراجع فرع أ";
    b.fullName = "مراجع فرع ب";
    await issueFor(a);
    await issueFor(b);
    const { role, member } = roleOf("receptionist");
    role.permissions = ["view:invoices:branch"];
    member.allBranches = false;
    member.branchIds = [a.registrationBranchId];
    const text = JSON.stringify(await api.finance.listInvoices(as("receptionist"), {}));
    expect(text).toContain("مراجع فرع أ");
    expect(text).not.toContain("مراجع فرع ب");
  });

  it("NEGATIVE: an own-scope doctor sees only their own patients' names", async () => {
    const { role, member } = roleOf("doctor");
    const own = (id: string) => isOwnPatient(getState(), clinicIdAt(0), member.id, id);
    const mine = patients().find((p) => own(p.id));
    const theirs = patients().find((p) => !own(p.id));
    if (!mine || !theirs) throw new Error("seed");
    mine.fullName = "مراجع الطبيب نفسه";
    theirs.fullName = "مراجع طبيب آخر";
    await issueFor(mine);
    await issueFor(theirs);
    role.permissions = ["view:invoices:own"];
    const text = JSON.stringify(await api.finance.listInvoices(as("doctor"), {}));
    expect(text).toContain("مراجع الطبيب نفسه");
    expect(text).not.toContain("مراجع طبيب آخر");
  });

  it("NEGATIVE: a role without view:invoices is still refused as forbidden", async () => {
    const { role } = roleOf("receptionist");
    role.permissions = role.permissions.filter((k) => !k.startsWith("view:invoices:"));
    expect(await fails(api.finance.listInvoices(as("receptionist"), {}))).toBe("forbidden");
  });

  it("writes no audit row (no patient-file open) when listing", async () => {
    const p = patients()[0];
    if (!p) throw new Error("seed");
    await issueFor(p);
    const before = getState().clinicAudit.length;
    const page = await api.finance.listInvoices(admin(), {});
    expect(page.items.length).toBeGreaterThan(0);
    expect(getState().clinicAudit.length).toBe(before);
  });

  it("answers unknown, never an empty name, when an item's patient record is missing", async () => {
    const p = patients()[0];
    if (!p) throw new Error("seed");
    await issueFor(p);
    const db = getState();
    db.patients = db.patients.filter((x) => x.id !== p.id);
    // `fails` maps a success to "unknown" too, so assert the rejection itself.
    const error = await api.finance.listInvoices(admin(), {}).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "unknown" });
  });
});
