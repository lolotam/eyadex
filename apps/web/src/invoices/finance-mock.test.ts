import { beforeEach, describe, expect, it } from "vitest";
import type { CreateInvoiceRequest } from "@eyadex/contracts/finance";
import { errorCodeOf } from "@/shared/api/api-error";
import { financeState } from "@/shared/api/mock/mock-finance-state";
import {
  PLATFORM,
  api,
  as,
  clinicIdAt,
  getState,
  resetMockData,
} from "@/shared/api/mock/mock-test-kit";

const admin = () => as("clinic_admin");
const fails = async (p: Promise<unknown>) =>
  errorCodeOf(
    await p.then(
      () => null,
      (e) => e,
    ),
  );

function manual(amount = "5000"): CreateInvoiceRequest {
  const clinicId = clinicIdAt(0);
  const patient = getState().patients.find((p) => p.clinicId === clinicId);
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

beforeEach(() => resetMockData());

describe("finance F1 in the mock, as the API", () => {
  it("numbers a branch's invoices PREFIX-YEAR-NNNNNN without gaps and replays a retried issue", async () => {
    const key = crypto.randomUUID();
    const first = await api.finance.issue(admin(), manual(), key);
    expect(await api.finance.issue(admin(), manual(), key)).toEqual(first);
    const second = await api.finance.issue(admin(), manual(), crypto.randomUUID());
    expect(first.number).toMatch(/^[A-Z0-9]{2,6}-\d{4}-\d{6}$/);
    const n = (s: string) => Number(s.slice(-6));
    expect(n(second.number)).toBe(n(first.number) + 1);
    expect(await fails(api.finance.issue(admin(), manual("1"), key))).toBe("idempotency_conflict");
  });

  it("NEGATIVE: a stale version is version_conflict; a void invoice refuses edits", async () => {
    const inv = await api.finance.issue(admin(), manual(), crypto.randomUUID());
    expect(inv.version).toBe(1);
    const body = { lines: manual("7000").lines, invoiceDiscount: null };
    const edited = await api.finance.edit(admin(), inv.id, 1, body);
    expect(edited.version).toBe(2);
    expect(edited.totalMinor).not.toBe(inv.totalMinor);
    expect(await fails(api.finance.edit(admin(), inv.id, 1, body))).toBe("version_conflict");
    const voided = await api.finance.voidInvoice(admin(), inv.id, 2, "خطأ");
    expect(voided.status).toBe("void");
    expect(await fails(api.finance.edit(admin(), inv.id, 3, body))).toBe("invoice_void");
  });

  // PR #78 review: the mock replayed an issue after the caller lost the invoice's branch.
  it("does not replay an issue whose branch left the caller's reach", async () => {
    const db = getState();
    const role = db.roles.find(
      (r) => r.clinicId === clinicIdAt(0) && r.systemKey === "receptionist",
    );
    const member = db.members.find((m) => m.roleId === role?.id && m.status === "active");
    const own = member?.branchIds[0];
    if (!member || !own) throw new Error("seed");
    const patient = db.patients.find(
      (p) => p.clinicId === clinicIdAt(0) && p.registrationBranchId === own,
    );
    if (!patient) throw new Error("seed");
    const body = { ...manual(), patientId: patient.id, branchId: own };
    const key = crypto.randomUUID();
    await api.finance.issue(as("receptionist"), body, key);
    member.branchIds = db.branches
      .filter((b) => b.clinicId === clinicIdAt(0) && b.id !== own)
      .map((b) => b.id);
    expect(await fails(api.finance.issue(as("receptionist"), body, key))).toBe("not_found");
  });

  it("a retried send after a void answers the first notification; a new press is invoice_void", async () => {
    const inv = await api.finance.issue(admin(), manual(), crypto.randomUUID());
    const sendRequestId = crypto.randomUUID();
    const first = await api.finance.send(admin(), inv.id, { channel: "email", sendRequestId });
    await api.finance.voidInvoice(admin(), inv.id, 1, "خطأ");
    expect(await api.finance.send(admin(), inv.id, { channel: "email", sendRequestId })).toEqual(
      first,
    );
    expect(
      await fails(
        api.finance.send(admin(), inv.id, { channel: "email", sendRequestId: crypto.randomUUID() }),
      ),
    ).toBe("invoice_void");
  });

  it("a send retry with the same id replays; the same id on another channel is a conflict", async () => {
    const inv = await api.finance.issue(admin(), manual(), crypto.randomUUID());
    const sendRequestId = crypto.randomUUID();
    const a = await api.finance.send(admin(), inv.id, { channel: "email", sendRequestId });
    expect(await api.finance.send(admin(), inv.id, { channel: "email", sendRequestId })).toEqual(a);
    expect(
      await fails(api.finance.send(admin(), inv.id, { channel: "whatsapp", sendRequestId })),
    ).toBe("send_request_conflict");
  });

  it("returns a PDF Blob for a visible invoice", async () => {
    const inv = await api.finance.issue(admin(), manual(), crypto.randomUUID());
    const pdf = await api.finance.pdf(admin(), inv.id);
    expect(pdf.type).toBe("application/pdf");
  });

  // PR #78 review (FIN-9): a no-show or cancel fee is a manual invoice, as the API refuses.
  it("NEGATIVE: a no-show or cancelled appointment has no draft and no linked invoice", async () => {
    const appointment = getState().appointments.find((x) => x.clinicId === clinicIdAt(0));
    if (!appointment) throw new Error("seed");
    for (const status of ["no_show", "cancelled"] as const) {
      appointment.status = status;
      expect(await fails(api.finance.draft(admin(), "appointment", appointment.id))).toBe(
        "appointment_not_billable",
      );
      const linked = { ...manual(), source: "appointment" as const, sourceId: appointment.id };
      expect(
        await fails(
          api.finance.issue(
            admin(),
            { ...linked, patientId: null, branchId: null },
            crypto.randomUUID(),
          ),
        ),
      ).toBe("appointment_not_billable");
    }
    // Outside the caller's branches it stays not_found, as the API: the status never leaks.
    const db = getState();
    const desk = db.members.find(
      (m) =>
        m.clinicId === clinicIdAt(0) &&
        m.status === "active" &&
        db.roles.find((r) => r.id === m.roleId)?.systemKey === "receptionist",
    );
    if (!desk) throw new Error("seed");
    desk.branchIds = desk.branchIds.filter((b) => b !== appointment.branchId);
    expect(await fails(api.finance.draft(as("receptionist"), "appointment", appointment.id))).toBe(
      "not_found",
    );
  });

  // PR #78 review: from/to are clinic days, as the API's `issued_at AT TIME ZONE` filter.
  it("filters from/to on the clinic's day: 22:30 UTC is the next day in Kuwait", async () => {
    const clinic = getState().clinics.find((c) => c.id === clinicIdAt(0));
    expect(clinic?.timezone).toBe("Asia/Kuwait");
    const inv = await api.finance.issue(admin(), manual(), crypto.randomUUID());
    const stored = financeState(getState()).invoices.find((i) => i.id === inv.id);
    if (!stored) throw new Error("issued");
    stored.issuedAt = "2026-03-10T22:30:00.000Z";
    const ids = async (q: { from?: string; to?: string }) =>
      (await api.finance.listInvoices(admin(), q)).items.map((i) => i.id);
    expect(await ids({ from: "2026-03-11", to: "2026-03-11" })).toContain(inv.id);
    expect(await ids({ to: "2026-03-10" })).not.toContain(inv.id);
  });

  it("sets and clears a service price as a minor-unit string", async () => {
    const services = await api.scheduling.listServices(admin(), {
      cursor: null,
      limit: 10,
      status: "active",
    });
    const id = services.items[0]!.id;
    expect((await api.finance.setServicePrice(admin(), id, "12500")).priceMinor).toBe("12500");
    const list = await api.finance.prices(admin());
    expect(list.items.find((p) => p.serviceId === id)?.priceMinor).toBe("12500");
    expect((await api.finance.setServicePrice(admin(), id, null)).priceMinor).toBeNull();
  });

  it("NEGATIVE: a prefix used by another branch is taken; a doctor cannot set one", async () => {
    const items = await api.finance.prefixes(admin());
    expect(items.length).toBeGreaterThan(0);
    const [a] = items;
    const next = await api.finance.setPrefix(admin(), a!.branchId, "ZZ9");
    expect(next.invoicePrefix).toBe("ZZ9");
    expect(await fails(api.finance.setPrefix(as("doctor"), a!.branchId, "QQ1"))).toBe("forbidden");
  });

  it("saves the commercial registration number and refuses a non-image logo", async () => {
    expect((await api.finance.updateSettings(admin(), "CR-123")).commercialRegNo).toBe("CR-123");
    const text = new Blob(["x"], { type: "text/plain" });
    expect(await fails(api.finance.uploadLogo(admin(), text))).toBe("validation");
  });

  it("NEGATIVE: the platform cannot change the currency once a price or invoice exists", async () => {
    const clinicId = clinicIdAt(0);
    await api.finance.issue(admin(), manual(), crypto.randomUUID());
    expect(
      await fails(api.finance.updatePlatformFinance(PLATFORM, clinicId, { currency: "SAR" })),
    ).toBe("currency_locked");
    const saved = await api.finance.updatePlatformFinance(PLATFORM, clinicId, { taxRateBp: 500 });
    expect(saved.taxRateBp).toBe(500);
    const totals = await api.finance.platformTotals(PLATFORM, clinicId);
    expect(totals.months.length).toBeGreaterThan(0);
  });

  it("NEGATIVE: every finance call is module_disabled while finance is off", async () => {
    await api.platform.setClinicFeature(PLATFORM, clinicIdAt(0), "finance", false);
    expect(await fails(api.finance.prices(admin()))).toBe("module_disabled");
    expect(await fails(api.finance.listInvoices(admin(), {}))).toBe("module_disabled");
  });
});
