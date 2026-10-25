import { beforeEach, describe, expect, it } from "vitest";
import type { CreateInvoiceRequest } from "@eyadex/contracts/finance";
import { resetMockData } from "./mock-test-kit";
import { financeState } from "./mock-finance-state";
import { isOwnPatient } from "./mock-own-scope";
import {
  admin,
  api,
  as,
  clinicIdAt,
  freeLine,
  getState,
  issue,
  memberOf,
  personaWith,
  range,
} from "./mock-report-test-kit";

beforeEach(() => resetMockData());

type Line = CreateInvoiceRequest["lines"][number];

/** A priced service line of the clinic, billed by the given doctor. */
function serviceLine(providerId: string, unitPriceMinor: string): Line {
  const service = getState().services.find((s) => s.clinicId === clinicIdAt(0) && s.isActive)!;
  return {
    kind: "service",
    serviceId: service.id,
    providerId,
    quantity: 1,
    unitPriceMinor,
    discount: null,
  } as Line;
}

describe("R10 own summary", () => {
  it("counts only the doctor's own lines on his own patients, matching his invoice list", async () => {
    const doctor = memberOf("doctor");
    const db = getState();
    const patients = db.patients.filter((p) => p.clinicId === clinicIdAt(0));
    const own = patients.find((p) => isOwnPatient(db, clinicIdAt(0), doctor.id, p.id));
    const other = patients.find((p) => !isOwnPatient(db, clinicIdAt(0), doctor.id, p.id));
    if (!own || !other) throw new Error("seed");
    const mine = await issue([serviceLine(doctor.id, "4000"), freeLine("900")], own);
    // His line on a patient who is not his own does not count: R10 never widens the invoice reach.
    await issue([serviceLine(doctor.id, "7000")], other);
    const r10 = await api.reports.ownSummary(as("doctor"), range());
    expect(r10.totals.billedMinor).toBe("4000");
    expect(r10.rows).toEqual([expect.objectContaining({ billedMinor: "4000" })]);
    const listed = await api.finance.listInvoices(as("doctor"), {});
    const ids = listed.items.filter((i) => i.status === "issued").map((i) => i.id);
    const reported = financeState(getState())
      .invoices.filter((i) => i.lines.some((l) => l.providerId === doctor.id))
      .filter((i) => ids.includes(i.id))
      .map((i) => i.id);
    expect(reported).toEqual([mine.id]);
  });

  it("another doctor's lines never count", async () => {
    const doctor = memberOf("doctor");
    const db = getState();
    const own = db.patients.find(
      (p) => p.clinicId === clinicIdAt(0) && isOwnPatient(db, clinicIdAt(0), doctor.id, p.id),
    )!;
    await issue([serviceLine(memberOf("clinic_admin").id, "3000")], own, null, admin());
    const r10 = await api.reports.ownSummary(as("doctor"), range());
    expect(r10.totals.billedMinor).toBe("0");
  });

  it("an own report key with no own invoices key is forbidden", async () => {
    const p = personaWith(["view:report_own:own"]);
    await expect(api.reports.ownSummary(p, range())).rejects.toMatchObject({ code: "forbidden" });
  });
});
