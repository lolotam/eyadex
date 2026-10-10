import { beforeEach, describe, expect, it } from "vitest";
import { wallToInstant } from "@eyadex/contracts/clinic-time";
import { errorCodeOf } from "@/shared/api/api-error";
import {
  api,
  as,
  clinicIdAt,
  getState,
  PLATFORM,
  resetMockData,
} from "@/shared/api/mock/mock-test-kit";

// Slice A4 in the mock, as the API's week and month reads (appointment-calendar.ts).
const SUNDAY = "2027-03-07";
const fails = async (p: Promise<unknown>) =>
  errorCodeOf(
    await p.then(
      () => null,
      (e) => e,
    ),
  );
const db = () => getState();
const roleOf = (key: string) =>
  db().roles.find((r) => r.clinicId === clinicIdAt(0) && r.systemKey === key)!;
const membersOf = (key: string) =>
  db().members.filter(
    (m) => m.clinicId === clinicIdAt(0) && m.status === "active" && m.roleId === roleOf(key).id,
  );
const doctor = () => membersOf("doctor")[0]!;
const branch = () => doctor().branchIds[0]!;
const tz = () => db().clinics[0]!.timezone;
const patient = () =>
  db().patients.find((p) => p.clinicId === clinicIdAt(0) && p.status === "active")!.id;

async function book(provider: string, date: string, time: string) {
  const answer = await api.appointments.create(
    as("clinic_admin"),
    {
      branchId: branch(),
      providerMembershipId: provider,
      patientId: patient(),
      serviceId: null,
      startsAt: wallToInstant(date, time, tz()),
      endsAt: null,
      overbook: true,
    },
    crypto.randomUUID(),
  );
  return answer.appointment!.id;
}

/** The admin as a second provider in the doctor's branch, Sunday hours. */
async function secondProvider(): Promise<string> {
  const admin = membersOf("clinic_admin")[0]!;
  await api.scheduling.setBookingProfile(as("clinic_admin"), admin.id, {
    acceptsAppointments: true,
    defaultDurationMinutes: 20,
  });
  await api.scheduling.replaceBranchSchedule(as("clinic_admin"), admin.id, branch(), {
    shifts: [{ weekday: 0, startsAt: "08:00", endsAt: "20:00" }],
  });
  return admin.id;
}

const week = (persona = as("clinic_admin"), provider = doctor().id) =>
  api.appointments.week(persona, {
    branchId: branch(),
    providerMembershipId: provider,
    weekStart: SUNDAY,
  });
const month = (persona = as("clinic_admin"), providerMembershipId?: string) =>
  api.appointments.month(persona, {
    branchId: branch(),
    month: "2027-03",
    ...(providerMembershipId ? { providerMembershipId } : {}),
  });

beforeEach(() => resetMockData());

describe("the provider week (mock)", () => {
  it("has seven days from weekStart, each with this branch's rows only", async () => {
    const other = db().branches.find(
      (b) => b.clinicId === clinicIdAt(0) && b.id !== branch() && b.isActive,
    );
    if (other) {
      db().scheduleRows.push({
        id: crypto.randomUUID(),
        clinicId: clinicIdAt(0),
        membershipId: doctor().id,
        branchId: other.id,
        weekday: 0,
        startsAt: "21:00",
        endsAt: "23:00",
      });
    }
    const answer = await week();
    expect(answer.days.map((d) => d.date)).toEqual([
      "2027-03-07",
      "2027-03-08",
      "2027-03-09",
      "2027-03-10",
      "2027-03-11",
      "2027-03-12",
      "2027-03-13",
    ]);
    const mine = db().scheduleRows.filter(
      (r) => r.membershipId === doctor().id && r.branchId === branch() && r.weekday === 0,
    );
    expect(answer.days[0]!.shifts).toHaveLength(mine.length);
    expect(answer.days[0]!.shifts.some((s) => s.startsAt === "21:00")).toBe(false);
  });

  it("never shows a cancelled appointment", async () => {
    const kept = await book(doctor().id, "2027-03-08", "09:00");
    const gone = await book(doctor().id, "2027-03-09", "09:00");
    await api.appointments.cancel(as("clinic_admin"), gone, { reason: "other", note: "" });
    const ids = (await week()).appointments.map((a) => a.id);
    expect(ids).toContain(kept);
    expect(ids).not.toContain(gone);
  });

  it("under own reads only the caller; another provider is not_found; a wider key wins", async () => {
    const other = await secondProvider();
    expect((await week(as("doctor"))).provider.membershipId).toBe(doctor().id);
    expect(await fails(week(as("doctor"), other))).toBe("not_found");
    roleOf("doctor").permissions = ["view:appointments:own", "view:appointments:branch"];
    expect((await week(as("doctor"), other)).provider.membershipId).toBe(other);
  });

  it("is module_disabled with the module off", async () => {
    await api.platform.setClinicFeature(PLATFORM, clinicIdAt(0), "appointments", false);
    expect(await fails(week())).toBe("module_disabled");
    expect(await fails(month())).toBe("module_disabled");
  });
});

describe("the month (mock)", () => {
  it("lists every day of the month and counts live appointments on their start day", async () => {
    await book(doctor().id, "2027-03-10", "09:00");
    await book(doctor().id, "2027-03-10", "10:00");
    const gone = await book(doctor().id, "2027-03-11", "09:00");
    await api.appointments.cancel(as("clinic_admin"), gone, { reason: "other", note: "" });
    // Starts late on the 31st in the clinic's zone: counted on the 31st only.
    await book(doctor().id, "2027-03-31", "23:30");
    const answer = await month();
    expect(answer.days).toHaveLength(31);
    expect(answer.days[0]!.date).toBe("2027-03-01");
    const count = (date: string) => answer.days.find((d) => d.date === date)!.count;
    expect(count("2027-03-10")).toBe(2);
    expect(count("2027-03-11")).toBe(0);
    expect(count("2027-03-31")).toBe(1);
    const feb = await api.appointments.month(as("clinic_admin"), {
      branchId: branch(),
      month: "2027-02",
    });
    expect(feb.days).toHaveLength(28);
  });

  it("filters by provider, and under own always counts the caller's own", async () => {
    const other = await secondProvider();
    await book(doctor().id, SUNDAY, "09:00");
    await book(other, SUNDAY, "09:00");
    const count = (m: Awaited<ReturnType<typeof month>>) =>
      m.days.find((d) => d.date === SUNDAY)!.count;
    expect(count(await month())).toBe(2);
    expect(count(await month(as("clinic_admin"), other))).toBe(1);
    expect(count(await month(as("doctor")))).toBe(1);
    expect(await fails(month(as("doctor"), other))).toBe("not_found");
  });
});
