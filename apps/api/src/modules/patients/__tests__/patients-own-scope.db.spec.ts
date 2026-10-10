import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { patientListResponseSchema } from "@eyadex/contracts/patients-api";

import {
  addPatient,
  at,
  book,
  bookingBody,
  bookingClinic,
  SUNDAY,
  type BookingClinic,
} from "../../appointments/__tests__/appointment-fixtures.ts";
import { send } from "../../appointments/__tests__/scheduling-fixtures.ts";
import {
  closeHarness,
  openHarness,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import {
  act,
  customRole,
  memberOn,
  roleIdOf,
  setMaxUsers,
} from "../../identity/__tests__/user-fixtures.ts";
import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import {
  branchOptions,
  code,
  createPatient,
  openPatient,
  patientAudit,
  patientBody,
  search,
} from "./patient-fixtures.ts";

// D-4, spec §8, ADR-0026 A3: a file is "own" when it has at least one appointment with the caller that
// is not cancelled, past or future, in any branch. As eyadex_app over HTTP.
let h: Harness;
let C: BookingClinic;
let other: BookingClinic;
let doctor: Awaited<ReturnType<typeof memberOn>>;
const files: Record<"inD" | "inX" | "cancelled" | "theirs" | "unbooked", string> = {
  inD: "",
  inX: "",
  cancelled: "",
  theirs: "",
  unbooked: "",
};
let minute = 0;

/** A booking of `provider` for `patient` on branch D, as the admin; each one later than the last. */
async function booked(patient: string, provider: string): Promise<string> {
  minute += 30;
  const time = `${String(8 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const res = await book(
    h,
    C.admin.cookie,
    bookingBody(C, patient, at(SUNDAY, time), { providerMembershipId: provider }),
  );
  if (res.statusCode !== 201) throw new Error(`book ${res.statusCode} ${res.body}`);
  return res.json().appointment.id as string;
}

const nameOf = async (id: string) =>
  (await h.owner`SELECT full_name, phone, file_number FROM patients WHERE id = ${id}`)[0]!;

const ids = (res: { json: () => unknown }) =>
  patientListResponseSchema.parse(res.json()).items.map((p) => p.id);

beforeAll(async () => {
  h = await openHarness({}, true);
  const invalidate = h.app.get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR);
  C = await bookingClinic(h, invalidate);
  other = await bookingClinic(h, invalidate);
  await setMaxUsers(h, C.clinicId, 50);
  // An own-only viewer of files who is also a provider on branch D, booked by the admin.
  const role = await customRole(h, C.clinicId, ["view:patients:own", "create:patients:branch"]);
  doctor = await memberOn(h, C.admin, role, { allBranches: false, branchIds: [C.branchD] });
  const put = (url: string, body: unknown) => send(h, C.admin.cookie, "PUT", url, body);
  await put(`/v1/users/${doctor.memberId}/booking-profile`, {
    acceptsAppointments: true,
    defaultDurationMinutes: 20,
  });
  const shifts = [{ weekday: 0, startsAt: "08:00", endsAt: "20:00" }];
  await put(`/v1/schedules/${doctor.memberId}/branches/${C.branchD}`, { shifts });

  files.inD = await addPatient(h, C.clinicId, C.branchD);
  files.inX = await addPatient(h, C.clinicId, C.branchX);
  files.cancelled = await addPatient(h, C.clinicId, C.branchD);
  files.theirs = await addPatient(h, C.clinicId, C.branchD);
  files.unbooked = await addPatient(h, C.clinicId, C.branchD);
  await booked(files.inD, doctor.memberId);
  await booked(files.inX, doctor.memberId);
  const gone = await booked(files.cancelled, doctor.memberId);
  const cancel = await send(h, C.admin.cookie, "POST", `/v1/appointments/${gone}/cancel`, {
    reason: "patient_cancelled",
    note: null,
  });
  if (cancel.statusCode !== 200) throw new Error(`cancel ${cancel.statusCode}`);
  await booked(files.theirs, C.doctor.memberId);
});
afterAll(async () => {
  await closeHarness(h);
});

describe("view:patients:own (D-4, ADR-0026 A3)", () => {
  it("lists exactly the files with a live appointment with the caller, and counts only those", async () => {
    const res = await search(h, doctor.cookie);
    expect(res.statusCode).toBe(200);
    expect(ids(res).sort()).toEqual([files.inD, files.inX].sort());
    expect(res.json().total).toBe(2);
  });

  it("a file whose only appointment with the caller is cancelled is not own (spec §8)", async () => {
    expect(ids(await search(h, doctor.cookie))).not.toContain(files.cancelled);
    expect((await openPatient(h, doctor.cookie, files.cancelled)).statusCode).toBe(404);
  });

  it("another provider's patient is absent and not_found when opened", async () => {
    expect(ids(await search(h, doctor.cookie))).not.toContain(files.theirs);
    const res = await openPatient(h, doctor.cookie, files.theirs);
    expect(res.statusCode).toBe(404);
    expect(code(res)).toBe("not_found");
    expect((await openPatient(h, doctor.cookie, files.unbooked)).statusCode).toBe(404);
  });

  it("an own file registered in a branch outside the caller's membership is visible", async () => {
    const res = await openPatient(h, doctor.cookie, files.inX);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: files.inX, registrationBranchId: C.branchX });
    expect(res.json().actions).toEqual({ update: false, deactivate: false });
  });

  it("opening an own file writes one patient.opened row", async () => {
    const before = (await patientAudit(h, C.clinicId, files.inD)).length;
    expect((await openPatient(h, doctor.cookie, files.inD)).statusCode).toBe(200);
    const rows = await patientAudit(h, C.clinicId, files.inD);
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toMatchObject({ action: "patient.opened", actor_user_id: doctor.userId });
  });

  it("a search by name, phone or file number stays inside own", async () => {
    const mine = await nameOf(files.inD);
    const theirs = await nameOf(files.theirs);
    // A name holding hex digits also searches by digits, so other own files may match too.
    expect(ids(await search(h, doctor.cookie, { q: mine["full_name"] }))).toContain(files.inD);
    const byName = ids(await search(h, doctor.cookie, { q: theirs["full_name"] }));
    expect(byName).not.toContain(files.theirs);
    expect(byName.every((id) => [files.inD, files.inX].includes(id))).toBe(true);
    const digits = String(theirs["phone"]).slice(-8);
    expect(ids(await search(h, doctor.cookie, { q: digits }))).not.toContain(files.theirs);
    const byNumber = await search(h, doctor.cookie, { q: String(theirs["file_number"]) });
    expect(ids(byNumber)).not.toContain(files.theirs);
    expect(ids(byNumber).every((id) => [files.inD, files.inX].includes(id))).toBe(true);
    const byBranch = await search(h, doctor.cookie, { branchId: C.branchX });
    expect(ids(byBranch)).toEqual([files.inX]);
  });

  it("another clinic's file is not_found (RLS)", async () => {
    const foreign = await addPatient(h, other.clinicId, other.branchD);
    expect((await openPatient(h, doctor.cookie, foreign)).statusCode).toBe(404);
  });

  it("the view branch options are the active branches of the caller's membership", async () => {
    const res = await branchOptions(h, doctor.cookie, "view");
    expect(res.statusCode).toBe(200);
    expect((res.json() as { id: string }[]).map((b) => b.id)).toEqual([C.branchD]);
  });

  it("a file the caller just created has no appointment yet, so its answer carries no detail", async () => {
    const res = await createPatient(h, doctor.cookie, patientBody(C.branchD));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ detail: null });
  });

  it("a branch holder's list is unchanged: every file of its branch, with or without bookings", async () => {
    const res = await search(h, C.front.cookie);
    expect(res.statusCode).toBe(200);
    const inR = await addPatient(h, C.clinicId, C.branchR);
    expect(ids(await search(h, C.front.cookie))).toContain(inR);
    expect(ids(await search(h, C.front.cookie))).not.toContain(files.inD);
  });
});

// Codex A3 r1: an own file may be registered in any branch, so a branch-scoped manager must not hand
// out view:patients:own (the new clinics' doctor role) and reach files outside its branches.
describe("granting the own-scope doctor role (ADR-0026 §12)", () => {
  it("a manager holding view:patients:branch may not give a member the doctor role", async () => {
    const managerRole = await customRole(h, C.clinicId, [
      "view:users:clinic",
      "update:users:clinic",
      "view:patients:branch",
      "view:appointments:branch",
    ]);
    const manager = await memberOn(h, C.admin, managerRole, {
      allBranches: false,
      branchIds: [C.branchD],
    });
    const target = await memberOn(h, C.admin, await customRole(h, C.clinicId, []), {
      allBranches: false,
      branchIds: [C.branchD],
    });
    const doctorRole = await roleIdOf(h, C.clinicId, "doctor");
    const url = `/v1/users/${target.memberId}/role`;
    const refused = await act(h, manager.cookie, url, { roleId: doctorRole }, "PATCH");
    expect([refused.statusCode, code(refused)]).toEqual([403, "forbidden"]);
    const allowed = await act(h, C.admin.cookie, url, { roleId: doctorRole }, "PATCH");
    expect(allowed.statusCode).toBe(200);
  });
});
