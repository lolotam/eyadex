import { beforeEach, describe, expect, it } from "vitest";
import { errorCodeOf } from "@/shared/api/api-error";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";

// PR #78 review, as the API: an appointment and the visit made from it are one encounter, billed once.
const fails = async (p: Promise<unknown>) =>
  errorCodeOf(
    await p.then(
      () => null,
      (e) => e,
    ),
  );

const line = {
  kind: "free" as const,
  descriptionAr: "كشف",
  descriptionEn: "Consultation",
  quantity: 1,
  unitPriceMinor: "1000",
  discount: null,
};
const admin = () => as("clinic_admin");
const issue = (source: "appointment" | "visit", sourceId: string) =>
  api.finance.issue(
    admin(),
    { source, sourceId, patientId: null, branchId: null, lines: [line], invoiceDiscount: null },
    crypto.randomUUID(),
  );

/** A seeded booking of the first clinic and a visit made from it. */
function encounter() {
  const db = getState();
  const appointment = db.appointments.find(
    (x) => x.clinicId === clinicIdAt(0) && x.status !== "cancelled" && x.status !== "no_show",
  );
  const template = db.medical.visits.find((v) => v.clinicId === clinicIdAt(0));
  if (!appointment || !template) throw new Error("seed");
  const visit = {
    ...template,
    id: crypto.randomUUID(),
    appointmentId: appointment.id,
    patientId: appointment.patientId,
    branchId: appointment.branchId,
  };
  db.medical.visits.push(visit);
  return { appointment: appointment.id, visit: visit.id };
}

beforeEach(() => resetMockData());

describe("one encounter, one live invoice", () => {
  it.each(["appointment", "visit"] as const)(
    "finds the opposite source from %s with encounter only",
    async (source) => {
      const pair = encounter();
      const other = source === "appointment" ? "visit" : "appointment";
      const invoice = await issue(other, pair[other]);
      const query = { source, sourceId: pair[source], status: "issued" as const };
      expect((await api.finance.listInvoices(admin(), query)).items).toEqual([]);
      expect(
        (await api.finance.listInvoices(admin(), { ...query, encounter: false })).items,
      ).toEqual([]);
      const page = await api.finance.listInvoices(admin(), { ...query, encounter: true });
      expect(page.items.map((i) => i.id)).toEqual([invoice.id]);
      expect(page.total).toBe(1);
      await api.finance.voidInvoice(admin(), invoice.id, 1, "issued twice");
      expect(
        (await api.finance.listInvoices(admin(), { ...query, encounter: true })).items,
      ).toEqual([]);
    },
  );

  it("keeps branch reach on an encounter lookup", async () => {
    const pair = encounter();
    const invoice = await issue("visit", pair.visit);
    const db = getState();
    const desk = as("receptionist");
    const role = db.roles.find(
      (r) => r.clinicId === clinicIdAt(0) && r.systemKey === "receptionist",
    )!;
    const member = db.members.find((m) => m.roleId === role.id && m.status === "active")!;
    role.permissions = ["view:invoices:branch"];
    member.allBranches = false;
    member.branchIds = [];
    const query = { source: "appointment" as const, sourceId: pair.appointment, encounter: true };
    expect((await api.finance.listInvoices(desk, query)).items).toEqual([]);
    expect((await api.finance.listInvoices(admin(), query)).items.map((i) => i.id)).toEqual([
      invoice.id,
    ]);
  });

  it("refuses the visit once its appointment is billed, in the issue and the draft", async () => {
    const { appointment, visit } = encounter();
    await issue("appointment", appointment);
    expect(await fails(issue("visit", visit))).toBe("invoice_already_exists");
    expect(await fails(api.finance.draft(admin(), "visit", visit))).toBe("invoice_already_exists");
  });

  it("refuses the appointment once its visit is billed, in the issue and the draft", async () => {
    const { appointment, visit } = encounter();
    await issue("visit", visit);
    expect(await fails(issue("appointment", appointment))).toBe("invoice_already_exists");
    expect(await fails(api.finance.draft(admin(), "appointment", appointment))).toBe(
      "invoice_already_exists",
    );
  });
});
