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
    expect(cleared.schedule!.dormantBranches).toEqual([]);
    const audit = getState().clinicAudit.filter((e) => e.action === "schedule.replaced");
    expect(audit.at(-1)?.after).toMatchObject({
      branchId: expect.objectContaining({ id: left.id }),
      shifts: [],
    });
    const saved = await api.scheduling.replaceBranchSchedule(admin(), d.id, own, wanted);
    expect(saved.schedule!.shifts.some((s) => s.weekday === 6 && s.branchId === own)).toBe(true);
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
    const cleared = await api.scheduling.replaceBranchSchedule(admin(), d.id, own, week());
    expect(cleared.schedule!.shifts).toEqual([]);
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

  it("NEGATIVE: a write answers with the schedule clipped to the view keys (Codex PR #63)", async () => {
    const receptionist = getState().roles.find(
      (r) => r.clinicId === clinicIdAt(0) && r.systemKey === "receptionist",
    )!;
    receptionist.permissions.push("view:schedules:branch", "update:schedules:clinic");
    const desk = getState().members.find(
      (m) => m.clinicId === clinicIdAt(0) && m.roleId === receptionist.id && m.status === "active",
    )!;
    const boss = getState().members.find(
      (m) => m.clinicId === clinicIdAt(0) && m.allBranches && m.status === "active",
    )!;
    getState().bookingProfiles[boss.id] = { acceptsAppointments: true, defaultDurationMinutes: 20 };
    const outside = getState().branches.find(
      (b) => b.clinicId === clinicIdAt(0) && b.isActive && !desk.branchIds.includes(b.id),
    )!;
    const saved = await api.scheduling.replaceBranchSchedule(
      as("receptionist"),
      boss.id,
      outside.id,
      week([4, "15:00", "16:00"]),
    );
    const seen = saved.schedule!;
    expect(seen.provider.allBranches).toBe(false);
    expect(seen.branches.every((b) => desk.branchIds.includes(b.id))).toBe(true);
    expect(seen.shifts.some((s) => s.branchId === outside.id)).toBe(false);
  });

  it("NEGATIVE: answers with no schedule for a provider the view keys do not see (Codex PR #63)", async () => {
    const receptionist = getState().roles.find(
      (r) => r.clinicId === clinicIdAt(0) && r.systemKey === "receptionist",
    )!;
    receptionist.permissions.push("view:schedules:branch", "update:schedules:clinic");
    const desk = getState().members.find(
      (m) => m.clinicId === clinicIdAt(0) && m.roleId === receptionist.id && m.status === "active",
    )!;
    const other = getState().members.find(
      (m) =>
        m.clinicId === clinicIdAt(0) &&
        m.status === "active" &&
        !m.allBranches &&
        !m.branchIds.some((id) => desk.branchIds.includes(id)),
    )!;
    getState().bookingProfiles[other.id] = {
      acceptsAppointments: true,
      defaultDurationMinutes: 20,
    };
    const start = new Date(Date.now() + 86_400_000).toISOString();
    const end = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const added = await api.scheduling.addTimeOff(as("receptionist"), other.id, {
      startsAt: start,
      endsAt: end,
      note: "private reason",
    });
    const off = getState().timeOff.find((t) => t.membershipId === other.id)!;
    const desks = as("receptionist");
    const saved = await api.scheduling.replaceBranchSchedule(
      desks,
      other.id,
      other.branchIds[0]!,
      week([5, "08:00", "09:00"]),
    );
    const cancelled = await api.scheduling.cancelTimeOff(desks, other.id, off.id);
    for (const answer of [added, saved, cancelled]) expect(answer).toEqual({ schedule: null });
    expect(off.cancelledAt).not.toBeNull();
  });

  it("a branch-scope editor sees and clears a provider's rows left in its branch, then not_found", async () => {
    const receptionist = getState().roles.find(
      (r) => r.clinicId === clinicIdAt(0) && r.systemKey === "receptionist",
    )!;
    receptionist.permissions.push("view:schedules:branch", "update:schedules:branch");
    const desk = getState().members.find(
      (m) => m.clinicId === clinicIdAt(0) && m.roleId === receptionist.id && m.status === "active",
    )!;
    const other = getState().members.find(
      (m) =>
        m.clinicId === clinicIdAt(0) &&
        m.status === "active" &&
        !m.allBranches &&
        !m.branchIds.some((id) => desk.branchIds.includes(id)),
    )!;
    getState().bookingProfiles[other.id] = {
      acceptsAppointments: true,
      defaultDurationMinutes: 20,
    };
    const here = desk.branchIds[0]!;
    keepRow(other.id, here, 1, "08:00", "09:00");
    const desks = as("receptionist");
    const listed = async () =>
      (await api.scheduling.listProviders(desks)).find((p) => p.membershipId === other.id);
    expect(await listed()).toMatchObject({ allBranches: false, branchIds: [] });
    const seen = await api.scheduling.getProviderSchedule(desks, other.id);
    expect(seen).toMatchObject({ branches: [], timeOff: [] });
    expect(seen.dormantBranches.map((b) => b.id)).toEqual([here]);
    expect(seen.shifts.every((s) => s.branchId === here)).toBe(true);
    const refill = week([1, "08:00", "09:00"]);
    expect(await fails(api.scheduling.replaceBranchSchedule(desks, other.id, here, refill))).toBe(
      "provider_not_in_branch",
    );
    const audits = () => getState().clinicAudit.filter((e) => e.action === "schedule.replaced");
    const before = audits().length;
    const cleared = await api.scheduling.replaceBranchSchedule(desks, other.id, here, week());
    // Cleared: the provider is outside the desk's view again, so the answer carries no schedule.
    expect(cleared).toEqual({ schedule: null });
    expect(audits()).toHaveLength(before + 1);
    expect(await listed()).toBeUndefined();
    expect(await fails(api.scheduling.getProviderSchedule(desks, other.id))).toBe("not_found");
    expect(await fails(api.scheduling.replaceBranchSchedule(desks, other.id, here, week()))).toBe(
      "not_found",
    );
  });

  it("NEGATIVE: a branch-scope editor's deactivated branch drops out of its reach (as the API)", async () => {
    const receptionist = getState().roles.find(
      (r) => r.clinicId === clinicIdAt(0) && r.systemKey === "receptionist",
    )!;
    receptionist.permissions.push("view:schedules:branch", "update:schedules:branch");
    const desk = getState().members.find(
      (m) => m.clinicId === clinicIdAt(0) && m.roleId === receptionist.id && m.status === "active",
    )!;
    const here = desk.branchIds[0]!;
    const there = { ...getState().branches.find((b) => b.id === here)!, id: crypto.randomUUID() };
    getState().branches.push(there);
    desk.branchIds = [here, there.id];
    // Seen only through a row left in `here`; the boss also works in `there`, inside the reach.
    const other = getState().members.find(
      (m) =>
        m.clinicId === clinicIdAt(0) &&
        m.status === "active" &&
        !m.allBranches &&
        !m.branchIds.some((id) => desk.branchIds.includes(id)),
    )!;
    const boss = getState().members.find(
      (m) => m.clinicId === clinicIdAt(0) && m.allBranches && m.status === "active",
    )!;
    for (const m of [other, boss]) {
      getState().bookingProfiles[m.id] = { acceptsAppointments: true, defaultDurationMinutes: 20 };
      keepRow(m.id, here, 1, "05:00", "06:00");
    }
    getState().branches.find((b) => b.id === here)!.isActive = false;
    const desks = as("receptionist");
    const listed = (await api.scheduling.listProviders(desks)).map((p) => p.membershipId);
    expect(listed).not.toContain(other.id);
    expect(await fails(api.scheduling.getProviderSchedule(desks, other.id))).toBe("not_found");
    expect(await fails(api.scheduling.replaceBranchSchedule(desks, other.id, here, week()))).toBe(
      "not_found",
    );
    expect(await fails(api.scheduling.replaceBranchSchedule(desks, boss.id, here, week()))).toBe(
      "forbidden",
    );
    expect((await api.scheduling.getProviderSchedule(desks, boss.id)).dormantBranches).toEqual([]);
  });
});
