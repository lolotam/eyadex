import { beforeEach, describe, expect, it } from "vitest";
import { wallToInstant } from "@eyadex/contracts/clinic-time";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { errorCodeOf } from "@/shared/api/api-error";

// ADR-0026 A3 in the mock, as the API's appointments-own-scope.db.spec.ts: `view:appointments:own`
// reaches the caller's own appointments only, the wider key wins, no other provider is named.
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
const doctorBranch = () => doctor().branchIds[0]!;
const at = (time: string) => wallToInstant(SUNDAY, time, db().clinics[0]!.timezone);

/** Another bookable provider in the doctor's branch: the admin, given hours there. */
async function secondProvider(): Promise<string> {
  const admin = membersOf("clinic_admin")[0]!;
  const persona = as("clinic_admin");
  await api.scheduling.setBookingProfile(persona, admin.id, {
    acceptsAppointments: true,
    defaultDurationMinutes: 20,
  });
  await api.scheduling.replaceBranchSchedule(persona, admin.id, doctorBranch(), {
    shifts: [{ weekday: 0, startsAt: "08:00", endsAt: "20:00" }],
  });
  return admin.id;
}

const booking = (providerMembershipId: string, time: string) => ({
  branchId: doctorBranch(),
  providerMembershipId,
  patientId: db().patients.find((p) => p.clinicId === clinicIdAt(0) && p.status === "active")!.id,
  serviceId: null,
  startsAt: at(time),
  endsAt: null,
  overbook: false,
});
const book = (provider: string, time: string, persona = as("clinic_admin")) =>
  api.appointments.create(persona, booking(provider, time), crypto.randomUUID());

beforeEach(() => resetMockData());

describe("view:appointments:own in the mock (ADR-0026 A3)", () => {
  it("the new clinics' doctor holds only the own keys (plus the clinic medicines list, P2, and own invoices, F1)", () => {
    expect(roleOf("doctor").permissions).toEqual([
      "view:appointments:own",
      "view:patients:own",
      "view:visits:own",
      "create:visits:own",
      "view:medical:own",
      "update:medical:own",
      "view:medicines:clinic",
      "view:invoices:own",
    ]);
  });

  it("lists the doctor's own active branches and shows only its column and appointments", async () => {
    const other = await secondProvider();
    await book(doctor().id, "09:00");
    await book(other, "09:00");
    const { items } = await api.appointments.listBranches(as("doctor"));
    expect(items.map((b) => b.id).sort()).toEqual([...doctor().branchIds].sort());
    const day = await api.appointments.day(as("doctor"), {
      branchId: doctorBranch(),
      date: SUNDAY,
    });
    expect(day.providers.map((p) => p.membershipId)).toEqual([doctor().id]);
    expect(day.appointments.every((a) => a.providerMembershipId === doctor().id)).toBe(true);
    expect(day.appointments.length).toBeGreaterThan(0);
    expect(JSON.stringify(day)).not.toContain(other);
    expect(day.can).toEqual({ create: false, update: false, overbook: false });
  });

  it("a branch outside the doctor's membership is not_found", async () => {
    const outside = db().branches.find(
      (b) => b.clinicId === clinicIdAt(0) && !doctor().branchIds.includes(b.id),
    )!;
    expect(
      await fails(api.appointments.day(as("doctor"), { branchId: outside.id, date: SUNDAY })),
    ).toBe("not_found");
  });

  it("the wider key held beside own wins", async () => {
    const other = await secondProvider();
    roleOf("doctor").permissions = ["view:appointments:own", "view:appointments:branch"];
    const day = await api.appointments.day(as("doctor"), {
      branchId: doctorBranch(),
      date: SUNDAY,
    });
    expect(day.providers.map((p) => p.membershipId)).toEqual(
      expect.arrayContaining([doctor().id, other]),
    );
  });

  it("a write answer under own shows only the caller's own appointment", async () => {
    const other = await secondProvider();
    roleOf("doctor").permissions = ["view:appointments:own", "create:appointments:branch"];
    expect((await book(doctor().id, "11:00", as("doctor"))).appointment?.providerMembershipId).toBe(
      doctor().id,
    );
    expect(await book(other, "11:00", as("doctor"))).toEqual({ appointment: null });
  });
});
