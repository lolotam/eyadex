import { NO_FEATURES } from "@eyadex/contracts/clinics";
import { beforeEach, expect, it } from "vitest";
import { fixture } from "./mock-report-export.test-kit";
import { api, as, personaWith, refusal } from "./mock-report-test-kit";

const cases = [
  ["daily_takings", ["view:report_takings:branch", "view:payments:branch"], false],
  [
    "period_summary",
    ["view:report_takings:branch", "view:invoices:branch", "view:payments:branch"],
    false,
  ],
  ["by_service", ["view:report_analytics:branch", "view:invoices:branch"], false],
  ["by_doctor", ["view:report_analytics:branch", "view:invoices:branch"], false],
  ["outstanding", ["view:report_patients:branch", "view:invoices:branch"], false],
  ["patient_credit", ["view:report_patients:clinic", "view:payments:clinic"], true],
  ["refunds", ["view:report_patients:branch", "view:payments:branch"], false],
  ["discounts", ["view:report_patients:branch", "view:invoices:branch"], false],
  ["cash_closings", ["view:report_takings:branch", "view:cash_closings:branch"], false],
  ["own_summary", ["view:report_own:own", "view:invoices:own"], true],
] as const;

let f: ReturnType<typeof fixture>;
beforeEach(() => {
  f = fixture();
});
const ids = () =>
  f.db.branches
    .filter((b) => b.clinicId === f.ctx.clinicId)
    .map((b) => b.id)
    .sort();

it.each(cases)(
  "%s exposes only its report reach, with no unrelated permission requirement",
  async (report, keys, all) => {
    const actor = personaWith([...keys], [f.a.id]);
    const page = await api.reports.branchOptions(actor, report, {});
    expect(page.items.map((b) => b.id).sort()).toEqual(all ? ids() : [f.a.id]);
    expect(page.total).toBe(all ? ids().length : 1);
    for (const branch of page.items) {
      expect(Object.keys(branch).sort()).toEqual(["id", "isActive", "nameAr", "nameEn"]);
      expect(branch.nameAr).not.toBe("");
      expect(branch.nameEn).not.toBe("");
    }
    for (const missing of keys.slice(1)) {
      const denied = personaWith(
        keys.filter((k) => k !== missing),
        [f.a.id],
      );
      expect(await refusal(api.reports.branchOptions(denied, report, {}))).toBe("forbidden");
    }
  },
);

it("does not widen report branches with unrelated permissions or an uncovered wider report key", async () => {
  const actor = personaWith(
    ["view:report_analytics:branch", "view:invoices:branch", "view:payments:clinic"],
    [f.a.id],
  );
  expect((await api.reports.branchOptions(actor, "by_service", {})).items.map((b) => b.id)).toEqual(
    [f.a.id],
  );
  const member = f.db.members.find((m) => m.id === actor.memberId)!;
  const role = f.db.roles.find((r) => r.id === member.roleId)!;
  role.permissions.push("view:report_analytics:clinic");
  expect(await refusal(api.reports.branchOptions(actor, "by_service", {}))).toBe("forbidden");
});

it("pages current names including inactive clinic branches, excludes inactive assigned branches, and isolates clinics", async () => {
  f.b.isActive = false;
  const actor = personaWith(["view:report_analytics:clinic", "view:invoices:clinic"], [f.a.id]);
  const audit = structuredClone(f.db.clinicAudit);
  const result: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await api.reports.branchOptions(actor, "by_service", {
      limit: 1,
      ...(cursor ? { cursor } : {}),
    });
    expect(page.total).toBe(ids().length);
    result.push(...page.items.map((b) => b.id));
    if (page.items[0]?.id === f.b.id) expect(page.items[0].isActive).toBe(false);
    cursor = page.nextCursor;
  } while (cursor);
  expect(result).toEqual(ids());
  const branch = personaWith(
    ["view:report_analytics:branch", "view:invoices:branch"],
    [f.a.id, f.b.id],
  );
  expect(
    (await api.reports.branchOptions(branch, "by_service", {})).items.map((b) => b.id),
  ).toEqual([f.a.id]);
  const other = as("clinic_admin", 1);
  if (!other.clinicId) throw new Error("Missing other clinic");
  f.db.features[other.clinicId] = {
    ...(f.db.features[other.clinicId] ?? NO_FEATURES),
    finance: true,
  };
  const theirs = await api.reports.branchOptions(other, "by_service", {});
  expect(theirs.items.length).toBeGreaterThan(0);
  expect(theirs.items.every((b) => !ids().includes(b.id))).toBe(true);
  expect(f.db.clinicAudit).toEqual(audit);
  const page = await api.reports.branchOptions(actor, "by_service", {});
  page.items[0]!.nameEn = "Caller mutation";
  expect((await api.reports.branchOptions(actor, "by_service", {})).items[0]!.nameEn).not.toBe(
    "Caller mutation",
  );
});

it("validates options in API order and applies live revocation, account, clinic, module and platform guards", async () => {
  const actor = personaWith([], [f.a.id]);
  const read = (limit = 0) => api.reports.branchOptions(actor, "by_service", { limit });
  expect(await refusal(read())).toBe("forbidden");
  const member = f.db.members.find((m) => m.id === actor.memberId)!;
  const role = f.db.roles.find((r) => r.id === member.roleId)!;
  role.permissions = ["view:report_analytics:branch"];
  expect(await refusal(read())).toBe("validation");
  expect(await refusal(read(20))).toBe("forbidden");
  role.permissions.push("view:invoices:branch");
  for (const query of [{ cursor: "bad" }, { limit: 101 }, { limit: 0 }])
    expect(await refusal(api.reports.branchOptions(actor, "by_service", query))).toBe("validation");
  role.isActive = false;
  expect(await refusal(read())).toBe("forbidden");
  role.isActive = true;
  f.db.features[f.ctx.clinicId] = {
    ...(f.db.features[f.ctx.clinicId] ?? NO_FEATURES),
    finance: false,
  };
  expect(await refusal(read())).toBe("module_disabled");
  f.ctx.access.clinic.status = "suspended";
  expect(await refusal(read())).toBe("subscription_blocked");
  member.status = "deactivated";
  expect(await refusal(read())).toBe("account_disabled");
  expect(await refusal(api.reports.branchOptions(as("platform_admin"), "by_service", {}))).toBe(
    "forbidden",
  );
});
