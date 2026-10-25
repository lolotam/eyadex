import { beforeEach, describe, expect, it } from "vitest";
import { resetMockData } from "./mock-test-kit";
import { admin, api, as, getState, personaWith, range, refusal } from "./mock-report-test-kit";

beforeEach(() => resetMockData());

const all = (p = admin()) => {
  const r = range();
  return {
    R1: () => api.reports.dailyTakings(p, r),
    R2: () => api.reports.periodSummary(p, r),
    R3: () => api.reports.byService(p, r),
    R4: () => api.reports.byDoctor(p, r),
    R5: () => api.reports.outstanding(p, r),
    R6: () => api.reports.patientCredit(p, r),
    R7: () => api.reports.refunds(p, r),
    R8: () => api.reports.discounts(p, r),
    R9: () => api.reports.cashClosings(p, r),
    R10: () => api.reports.ownSummary(p, r),
  };
};

async function reachable(p: ReturnType<typeof admin>) {
  const open: string[] = [];
  for (const [id, read] of Object.entries(all(p))) {
    if (
      await read().then(
        () => true,
        () => false,
      )
    )
      open.push(id);
  }
  return open;
}

describe("report keys (spec §8 key splits)", () => {
  it("a receptionist reaches R1, R2 and R9 only", async () => {
    expect(await reachable(as("receptionist"))).toEqual(["R1", "R2", "R9"]);
  });

  it("view:report_patients:branch without view:invoices gets nothing from R5", async () => {
    const p = personaWith(["view:report_patients:branch", "view:payments:branch"]);
    expect(await refusal(api.reports.outstanding(p, range()))).toBe("forbidden");
    // The payments key still covers R7, so the refusal is the missing invoices key, not the report key.
    await expect(api.reports.refunds(p, range())).resolves.toBeDefined();
  });

  it("report_own never opens R5, and opens R10 only with view:invoices:own itself", async () => {
    expect(await reachable(as("doctor"))).toEqual(["R10"]);
    const branchInvoices = personaWith(["view:report_own:own", "view:invoices:branch"]);
    expect(await refusal(api.reports.ownSummary(branchInvoices, range()))).toBe("forbidden");
  });

  it("R6 needs the clinic report key and view:payments at clinic scope", async () => {
    const branch = personaWith(["view:report_patients:clinic", "view:payments:branch"]);
    expect(await refusal(api.reports.patientCredit(branch, range()))).toBe("forbidden");
    const clinic = personaWith(["view:report_patients:clinic", "view:payments:clinic"]);
    await expect(api.reports.patientCredit(clinic, range())).resolves.toBeDefined();
  });

  it("the admin reaches every report but the own summary (it holds no own key)", async () => {
    expect(await reachable(admin())).toEqual([
      "R1",
      "R2",
      "R3",
      "R4",
      "R5",
      "R6",
      "R7",
      "R8",
      "R9",
    ]);
  });
});

describe("branch filter and range", () => {
  it("a branch outside the reach is forbidden; one inside narrows the rows", async () => {
    const db = getState();
    const [b1, b2] = db.branches.filter((b) => b.clinicId === db.clinics[0]!.id);
    const p = personaWith(["view:report_takings:branch", "view:payments:branch"], [b1!.id]);
    const r = range();
    expect(await refusal(api.reports.dailyTakings(p, { ...r, branchId: b2!.id }))).toBe(
      "forbidden",
    );
    await expect(api.reports.dailyTakings(p, { ...r, branchId: b1!.id })).resolves.toBeDefined();
  });

  it("366 days pass, 367 days answer report_range_too_long", async () => {
    await expect(
      api.reports.dailyTakings(admin(), { from: "2025-01-01", to: "2026-01-01" }),
    ).resolves.toBeDefined();
    expect(
      await refusal(api.reports.dailyTakings(admin(), { from: "2025-01-01", to: "2026-01-02" })),
    ).toBe("report_range_too_long");
  });

  it("the range is judged after the route key: no key is forbidden whatever the range", async () => {
    const p = personaWith(["view:payments:clinic"]);
    expect(
      await refusal(api.reports.dailyTakings(p, { from: "2025-01-01", to: "2026-01-02" })),
    ).toBe("forbidden");
  });

  it("a bad cursor is validation", async () => {
    expect(await refusal(api.reports.refunds(admin(), { ...range(), cursor: "nope" }))).toBe(
      "validation",
    );
  });
});
