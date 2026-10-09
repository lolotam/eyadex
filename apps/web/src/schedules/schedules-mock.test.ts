import { beforeEach, describe, expect, it } from "vitest";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { errorCodeOf, type ApiError } from "@/shared/api/api-error";

const admin = () => as("clinic_admin");
const fails = async (p: Promise<unknown>) =>
  errorCodeOf(
    await p.then(
      () => null,
      (e) => e,
    ),
  );
const week = (...rows: [number, string, string][]) => ({
  shifts: rows.map(([weekday, startsAt, endsAt]) => ({ weekday, startsAt, endsAt })),
});
const doctor = () =>
  getState().members.find((m) => {
    const role = getState().roles.find((r) => r.id === m.roleId);
    return m.clinicId === clinicIdAt(0) && m.status === "active" && role?.systemKey === "doctor";
  })!;

beforeEach(() => resetMockData());

describe("weekly schedules (D-6, D-14) in the mock, as the API", () => {
  it("lists the seeded bookable doctor and saves a week with one audit row", async () => {
    const d = doctor();
    expect((await api.scheduling.listProviders(admin())).map((p) => p.membershipId)).toContain(
      d.id,
    );
    const branchId = d.branchIds[0]!;
    const saved = await api.scheduling.replaceBranchSchedule(
      admin(),
      d.id,
      branchId,
      week([0, "20:00", "24:00"], [1, "00:00", "01:00"]),
    );
    expect(saved.shifts.filter((s) => s.branchId === branchId)).toHaveLength(2);
    const rows = getState().clinicAudit.filter((e) => e.action === "schedule.replaced");
    expect(rows).toHaveLength(1);
  });

  it("refuses overlaps, a branch the provider does not work in, and a member not bookable", async () => {
    const d = doctor();
    const branchId = d.branchIds[0]!;
    const clash = week([2, "08:00", "10:00"], [2, "09:00", "11:00"]);
    expect(await fails(api.scheduling.replaceBranchSchedule(admin(), d.id, branchId, clash))).toBe(
      "schedule_overlap",
    );
    const other = getState().branches.find(
      (b) => b.clinicId === clinicIdAt(0) && b.id !== branchId,
    )!;
    expect(
      await fails(
        api.scheduling.replaceBranchSchedule(admin(), d.id, other.id, week([3, "08:00", "09:00"])),
      ),
    ).toBe("provider_not_in_branch");
    getState().bookingProfiles[d.id] = { acceptsAppointments: false, defaultDurationMinutes: 20 };
    expect(
      await fails(
        api.scheduling.replaceBranchSchedule(admin(), d.id, branchId, week([3, "08:00", "09:00"])),
      ),
    ).toBe("provider_not_bookable");
  });

  it("time off: added, shown, cancelled (never deleted); needs the clinic-scope key", async () => {
    const d = doctor();
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const added = await api.scheduling.addTimeOff(admin(), d.id, {
      startsAt: start,
      endsAt: end,
      note: "x",
    });
    const off = added.timeOff.at(-1)!;
    const after = await api.scheduling.cancelTimeOff(admin(), d.id, off.id);
    expect(after.timeOff.map((t) => t.id)).not.toContain(off.id);
    expect(getState().timeOff.find((t) => t.id === off.id)?.cancelledAt).not.toBeNull();
    const audit = getState().clinicAudit.filter((e) => e.entityId === off.id);
    expect(JSON.stringify(audit)).not.toContain('"note"');
  });

  it("NEGATIVE: checks access before validating the request, as the API's guard", async () => {
    const bad = { shifts: [{ weekday: 9, startsAt: "x", endsAt: "y" }] };
    const branchId = doctor().branchIds[0]!;
    expect(
      await fails(
        api.scheduling.replaceBranchSchedule(as("receptionist"), doctor().id, branchId, bad),
      ),
    ).toBe("forbidden");
  });

  it("NEGATIVE: a branch-scope editor reaches only its branches", async () => {
    const receptionist = getState().roles.find(
      (r) => r.clinicId === clinicIdAt(0) && r.systemKey === "receptionist",
    )!;
    receptionist.permissions.push("view:schedules:branch", "update:schedules:branch");
    const desk = getState().members.find(
      (m) => m.clinicId === clinicIdAt(0) && m.roleId === receptionist.id && m.status === "active",
    )!;
    const deskBranch = desk.branchIds[0]!;
    const visible = (await api.scheduling.listProviders(as("receptionist"))).map(
      (p) => p.membershipId,
    );
    const d = doctor();
    expect(visible.includes(d.id)).toBe(d.branchIds.includes(deskBranch));
    // An all-branches provider shows the desk only the desk's branches, never the rest (Codex PR #63).
    const boss = getState().members.find(
      (m) => m.clinicId === clinicIdAt(0) && m.allBranches && m.status === "active",
    )!;
    getState().bookingProfiles[boss.id] = { acceptsAppointments: true, defaultDurationMinutes: 20 };
    const seen = await api.scheduling.listProviders(as("receptionist"));
    expect(seen.map((p) => p.membershipId)).toContain(boss.id);
    for (const p of seen) {
      expect(p.allBranches).toBe(false);
      expect(p.branchIds.every((id) => desk.branchIds.includes(id))).toBe(true);
    }
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 2 * 86_400_000).toISOString();
    expect(
      await fails(
        api.scheduling.addTimeOff(as("receptionist"), d.id, {
          startsAt: start,
          endsAt: end,
          note: null,
        }),
      ),
    ).toBe("forbidden");
  });
});

describe("dormant rows (Codex PR #63 P2, as the API)", () => {
  const keepRow = (memberId: string, branchId: string, weekday: number, from: string, to: string) =>
    getState().scheduleRows.push({
      id: crypto.randomUUID(),
      clinicId: clinicIdAt(0),
      membershipId: memberId,
      branchId,
      weekday,
      startsAt: from,
      endsAt: to,
    });
  const detailsOf = async (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: ApiError) => ({ code: e.code, details: e.details }),
    );

  it("rows of a branch the provider left: shown, block naming it, clear with an empty week", async () => {
    const d = doctor();
    const own = d.branchIds[0]!;
    const left = getState().branches.find((b) => b.clinicId === clinicIdAt(0) && b.id !== own)!;
    keepRow(d.id, left.id, 6, "08:00", "12:00");
    const seen = await api.scheduling.getProviderSchedule(admin(), d.id);
    expect(seen.dormantBranches.map((b) => b.id)).toEqual([left.id]);
    expect(seen.shifts.some((s) => s.branchId === left.id)).toBe(true);
    const wanted = week([6, "10:00", "14:00"]);
    expect(
      await detailsOf(api.scheduling.replaceBranchSchedule(admin(), d.id, own, wanted)),
    ).toEqual({ code: "schedule_overlap", details: { branchId: left.id } });
    expect(
      await fails(
        api.scheduling.replaceBranchSchedule(admin(), d.id, left.id, week([6, "08:00", "09:00"])),
      ),
    ).toBe("provider_not_in_branch");
    const cleared = await api.scheduling.replaceBranchSchedule(admin(), d.id, left.id, week());
    expect(cleared.dormantBranches).toEqual([]);
    const audit = getState().clinicAudit.filter((e) => e.action === "schedule.replaced");
    expect(audit.at(-1)?.after).toMatchObject({
      branchId: expect.objectContaining({ id: left.id }),
      shifts: [],
    });
    const saved = await api.scheduling.replaceBranchSchedule(admin(), d.id, own, wanted);
    expect(saved.shifts.some((s) => s.weekday === 6 && s.branchId === own)).toBe(true);
  });

  it("rows of an inactive branch: shown, block, refuse new hours, clear with an empty week", async () => {
    const d = doctor();
    const own = d.branchIds[0]!;
    keepRow(d.id, own, 1, "08:00", "12:00");
    const branch = getState().branches.find((b) => b.id === own)!;
    branch.isActive = false;
    const seen = await api.scheduling.getProviderSchedule(admin(), d.id);
    expect(seen.branches.map((b) => b.id)).not.toContain(own);
    expect(seen.dormantBranches).toEqual([expect.objectContaining({ id: own, isActive: false })]);
    expect(
      await fails(
        api.scheduling.replaceBranchSchedule(admin(), d.id, own, week([1, "08:00", "09:00"])),
      ),
    ).toBe("branch_inactive");
    expect((await api.scheduling.replaceBranchSchedule(admin(), d.id, own, week())).shifts).toEqual(
      [],
    );
  });

  it("NEGATIVE: a branch-scope editor neither sees, clears nor learns of dormant rows outside its reach", async () => {
    const receptionist = getState().roles.find(
      (r) => r.clinicId === clinicIdAt(0) && r.systemKey === "receptionist",
    )!;
    receptionist.permissions.push("view:schedules:branch", "update:schedules:branch");
    const desk = getState().members.find(
      (m) => m.clinicId === clinicIdAt(0) && m.roleId === receptionist.id && m.status === "active",
    )!;
    const boss = getState().members.find(
      (m) => m.clinicId === clinicIdAt(0) && m.allBranches && m.status === "active",
    )!;
    getState().bookingProfiles[boss.id] = { acceptsAppointments: true, defaultDurationMinutes: 20 };
    const outside = getState().branches.find(
      (b) => b.clinicId === clinicIdAt(0) && !desk.branchIds.includes(b.id),
    )!;
    keepRow(boss.id, outside.id, 3, "06:00", "07:00");
    outside.isActive = false;
    const seen = await api.scheduling.getProviderSchedule(as("receptionist"), boss.id);
    expect(seen.dormantBranches).toEqual([]);
    expect(seen.shifts.some((s) => s.branchId === outside.id)).toBe(false);
    const desks = as("receptionist");
    expect(
      await fails(api.scheduling.replaceBranchSchedule(desks, boss.id, outside.id, week())),
    ).toBe("forbidden");
    const wanted = week([3, "06:30", "08:00"]);
    expect(
      await detailsOf(
        api.scheduling.replaceBranchSchedule(desks, boss.id, desk.branchIds[0]!, wanted),
      ),
    ).toEqual({ code: "schedule_overlap", details: {} });
  });
});
