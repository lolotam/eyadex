import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { receiptPdf } from "@/shared/api/mock/mock-receipt-pdf";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { paymentState } from "@/shared/api/mock/mock-payment-state";
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
  voidIt,
} from "./payment-mock-kit";

beforeEach(() => resetMockData());
const missing = "00000000-0000-7000-8000-0000000000ff";
const audit = () => getState().clinicAudit.filter((a) => a.action === "payment.pdf_opened");
const clinic = () => getState().clinics.find((c) => c.id === clinicIdAt(0))!;
async function paid() {
  const invoice = await issue("5000");
  return { invoice, payment: (await pay(invoice.id, "1000")).payment };
}
function text(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

describe("receipt PDF mock parity", () => {
  it("downloads through PaymentsApi and writes one patient-access event with no snapshots", async () => {
    const { payment } = await paid();
    const blob = await api.payments.pdf(admin(), payment.id);
    expect(blob.type).toBe("application/pdf");
    expect(await text(blob)).toContain(payment.receiptNumber);
    expect(audit()).toHaveLength(1);
    expect(audit()[0]).toMatchObject({
      entity: "payment",
      entityId: payment.id,
      category: "patient_access",
      before: null,
      after: null,
    });
  });

  it("keeps the original payment amount after a full refund and invoice void", async () => {
    const { invoice, payment } = await paid();
    await api.payments.refund(
      admin(),
      invoice.id,
      {
        source: "payment",
        paymentId: payment.id,
        amountMinor: "1000",
        method: "cash",
        reason: "Test refund",
      },
      crypto.randomUUID(),
    );
    await voidIt(invoice.id);
    const source = await text(await api.payments.pdf(admin(), payment.id));
    expect(source).toContain("Amount 1.000 KWD");
  });

  it("refuses another clinic's receipt without an audit event", async () => {
    const { payment } = await paid();
    getState().features[clinicIdAt(1)]!.finance = true;
    const role = getState().roles.find(
      (r) => r.clinicId === clinicIdAt(1) && r.systemKey === "clinic_admin",
    )!;
    role.permissions.push("view:payments:clinic");
    expect(await refusal(api.payments.pdf(as("clinic_admin", 1), payment.id))).toBe("not_found");
    expect(audit()).toHaveLength(0);
  });

  it("refuses an out-of-scope branch", async () => {
    const { payment } = await paid();
    const { role, member } = roleOf("receptionist");
    role.permissions = ["view:payments:branch"];
    member.allBranches = false;
    member.branchIds = [
      clinicPatients().find((p) => p.registrationBranchId !== payment.branchId)!
        .registrationBranchId,
    ];
    expect(await refusal(api.payments.pdf(as("receptionist"), payment.id))).toBe("not_found");
    expect(audit()).toHaveLength(0);
  });

  it("refuses platform access", async () => {
    expect(await refusal(api.payments.pdf(as("platform_admin"), missing))).toBe("forbidden");
    expect(audit()).toHaveLength(0);
  });

  it("checks subscription before module, and module before permission", async () => {
    const { role } = roleOf("receptionist");
    role.permissions = [];
    getState().features[clinicIdAt(0)]!.finance = false;
    clinic().status = "suspended";
    expect(await refusal(api.payments.pdf(as("receptionist"), missing))).toBe(
      "subscription_blocked",
    );
    clinic().status = "active";
    expect(await refusal(api.payments.pdf(as("receptionist"), missing))).toBe("module_disabled");
    getState().features[clinicIdAt(0)]!.finance = true;
    expect(await refusal(api.payments.pdf(as("receptionist"), "bad-id"))).toBe("forbidden");
  });

  it("validates the route id after authorization", async () => {
    expect(await refusal(api.payments.pdf(admin(), "bad-id"))).toBe("validation");
    expect(await refusal(api.payments.pdf(admin(), missing))).toBe("not_found");
  });

  it.each([
    ["member", "account_disabled"],
    ["subscription", "subscription_blocked"],
    ["module", "module_disabled"],
    ["role", "forbidden"],
    ["permission", "forbidden"],
    ["branch", "not_found"],
  ])("rechecks %s after rendering", async (change, code) => {
    const { payment } = await paid();
    const { role, member } = roleOf("receptionist");
    role.permissions = ["view:payments:branch"];
    member.allBranches = true;
    const persona = { ...as("receptionist"), memberId: member.id };
    const result = receiptPdf(persona, payment.id, async () => {
      if (change === "member") member.status = "deactivated";
      if (change === "subscription") clinic().status = "suspended";
      if (change === "module") getState().features[clinicIdAt(0)]!.finance = false;
      if (change === "role") role.isActive = false;
      if (change === "permission") role.permissions = [];
      if (change === "branch") {
        member.allBranches = false;
        member.branchIds = [];
      }
      return new Blob(["%PDF"], { type: "application/pdf" });
    });
    expect(await refusal(result)).toBe(code);
    expect(audit()).toHaveLength(0);
  });

  it("writes no event on render failure", async () => {
    const { payment } = await paid();
    expect(
      await refusal(
        receiptPdf(admin(), payment.id, () => {
          throw new ApiError("pdf_render_failed");
        }),
      ),
    ).toBe("pdf_render_failed");
    expect(audit()).toHaveLength(0);
    expect(paymentState(getState()).payments).toHaveLength(1);
  });
});
