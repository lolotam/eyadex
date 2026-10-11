import { beforeEach, describe, expect, it } from "vitest";
import { wallToInstant } from "@eyadex/contracts/clinic-time";
import { api, as, clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";

// D-4 and spec §8 in the mock, as the API's patients-own-scope.db.spec.ts: a file is the doctor's own
// when it has at least one appointment with the doctor that is not cancelled, in any branch, or any
// visit the doctor is the provider of (P2 spec §2, R1-18: the API's `ownPatientSql`).
const ALL = { cursor: null, limit: 100, q: "", branchId: null, status: null };
const db = () => getState();
const clinicFiles = () => db().patients.filter((p) => p.clinicId === clinicIdAt(0));
const doctor = () => {
  const role = db().roles.find((r) => r.clinicId === clinicIdAt(0) && r.systemKey === "doctor")!;
  return db().members.find((m) => m.roleId === role.id && m.status === "active")!;
};
const ids = async () => (await api.patients.list(as("doctor"), ALL)).items.map((p) => p.id);

/** The doctor's appointment for the file, written straight into the store (any branch). */
function bookedWithDoctor(patientId: string, status: "booked" | "cancelled" = "booked") {
  const at = wallToInstant("2027-03-07", "09:00", db().clinics[0]!.timezone);
  db().appointments.push({
    id: crypto.randomUUID(),
    clinicId: clinicIdAt(0),
    branchId: doctor().branchIds[0]!,
    patientId,
    providerMembershipId: doctor().id,
    serviceId: null,
    startsAt: at,
    endsAt: at,
    status,
    overbooked: false,
    cancelReason: status === "cancelled" ? "other" : null,
    cancelNote: null,
    createdAt: at,
  });
}

beforeEach(() => {
  resetMockData();
  // Only this test's bookings and visits: the demo's seeded ones would make other files the doctor's own.
  db().appointments = db().appointments.filter((a) => a.clinicId !== clinicIdAt(0));
  db().medical.visits = db().medical.visits.filter((v) => v.clinicId !== clinicIdAt(0));
});

describe("view:patients:own in the mock (D-4, ADR-0026 A3)", () => {
  it("lists exactly the files with a live appointment with the doctor, in any branch", async () => {
    const [mine, elsewhere, cancelled] = [
      clinicFiles().find((p) => doctor().branchIds.includes(p.registrationBranchId))!,
      clinicFiles().find((p) => !doctor().branchIds.includes(p.registrationBranchId))!,
      clinicFiles().filter((p) => doctor().branchIds.includes(p.registrationBranchId))[1]!,
    ];
    bookedWithDoctor(mine.id);
    bookedWithDoctor(elsewhere.id);
    bookedWithDoctor(cancelled.id, "cancelled");
    expect((await ids()).sort()).toEqual([mine.id, elsewhere.id].sort());
    expect((await api.patients.list(as("doctor"), ALL)).total).toBe(2);
    expect((await api.patients.open(as("doctor"), elsewhere.id)).id).toBe(elsewhere.id);
    await expect(api.patients.open(as("doctor"), cancelled.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("another provider's file is not_found; opening an own file is audited", async () => {
    const [mine, theirs] = clinicFiles();
    bookedWithDoctor(mine!.id);
    await expect(api.patients.open(as("doctor"), theirs!.id)).rejects.toMatchObject({
      code: "not_found",
    });
    const before = db().clinicAudit.filter((e) => e.action === "patient.opened").length;
    await api.patients.open(as("doctor"), mine!.id);
    expect(db().clinicAudit.filter((e) => e.action === "patient.opened")).toHaveLength(before + 1);
  });

  it("no booking yet: an empty list; the view branch options are the doctor's active branches", async () => {
    expect(await ids()).toEqual([]);
    const options = await api.patients.branchOptions(as("doctor"), "view");
    expect(options.map((b) => b.id).sort()).toEqual([...doctor().branchIds].sort());
  });

  it("a visit with the doctor, cancelled too, makes the file its own (R1-18)", async () => {
    const [walkedIn, untouched] = clinicFiles();
    const visit = (patientId: string, providerMembershipId: string) => ({
      id: crypto.randomUUID(),
      clinicId: clinicIdAt(0),
      patientId,
      branchId: walkedIn!.registrationBranchId,
      providerMembershipId,
      appointmentId: null,
      status: "cancelled" as const,
      startedAt: new Date().toISOString(),
      signedAt: null,
      cancelReason: "opened_by_mistake" as const,
      cancelNote: null,
      note: { complaint: null, examination: null, assessment: null, plan: null },
      diagnoses: [],
      prescription: [],
      addenda: [],
    });
    db().medical.visits.push(visit(walkedIn!.id, doctor().id));
    db().medical.visits.push(visit(untouched!.id, crypto.randomUUID()));
    expect(await ids()).toEqual([walkedIn!.id]);
    expect((await api.patients.open(as("doctor"), walkedIn!.id)).id).toBe(walkedIn!.id);
  });

  it("the wider key held beside own wins", async () => {
    const role = db().roles.find((r) => r.id === doctor().roleId)!;
    role.permissions = ["view:patients:own", "view:patients:clinic"];
    expect((await api.patients.list(as("doctor"), ALL)).total).toBe(clinicFiles().length);
  });
});
