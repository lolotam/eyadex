import { beforeEach, describe, expect, it } from "vitest";
import { wallToInstant } from "@eyadex/contracts/clinic-time";
import {
  api,
  as,
  clinicIdAt,
  getState,
  PLATFORM,
  resetMockData,
} from "@/shared/api/mock/mock-test-kit";
import { errorCodeOf } from "@/shared/api/api-error";

// Slice A2 in the mock: the API's check order and rules (spec §4, D-3, D-5, D-6, D-11, D-14).
const SUNDAY = "2027-03-07";
const admin = () => as("clinic_admin");
const fails = async (p: Promise<unknown>) =>
  errorCodeOf(
    await p.then(
      () => null,
      (e) => e,
    ),
  );
const tz = () => getState().clinics[0]!.timezone;
const at = (time: string, date = SUNDAY) => wallToInstant(date, time, tz());
const roleOf = (key: string) =>
  getState().roles.find((r) => r.clinicId === clinicIdAt(0) && r.systemKey === key)!;
const memberWith = (key: string) =>
  getState().members.find(
    (m) => m.clinicId === clinicIdAt(0) && m.status === "active" && m.roleId === roleOf(key).id,
  )!;
const patientOf = (status: "active" | "archived") =>
  getState().patients.find((p) => p.clinicId === clinicIdAt(0) && p.status === status)!;
const body = (time: string, extra: Record<string, unknown> = {}) => {
  const doctor = memberWith("doctor");
  return {
    branchId: doctor.branchIds[0]!,
    providerMembershipId: doctor.id,
    patientId: patientOf("active").id,
    serviceId: null,
    startsAt: at(time),
    endsAt: null,
    overbook: false,
    ...extra,
  };
};
/** A reschedule body: the doctor's branch and the new interval. */
const moveTo = (time: string, end: string) => {
  const { branchId, providerMembershipId } = body(time);
  return { branchId, providerMembershipId, startsAt: at(time), endsAt: at(end), overbook: false };
};
const book = (time: string, extra: Record<string, unknown> = {}, persona = admin()) =>
  api.appointments.create(persona, body(time, extra), crypto.randomUUID());

beforeEach(() => resetMockData());

describe("check order", () => {
  it("a member with no appointments key is forbidden; with the module off, module_disabled comes first", async () => {
    expect(await fails(book("09:00", {}, as("technician")))).toBe("forbidden");
    await api.platform.setClinicFeature(PLATFORM, clinicIdAt(0), "appointments", false);
    expect(await fails(book("09:00", {}, as("technician")))).toBe("module_disabled");
    expect(await fails(book("09:00"))).toBe("module_disabled");
  });
});

describe("booking (rules 1, 2, 4, 7, 8, 9)", () => {
  it("books inside a shift with the default length; the audit row never names the patient", async () => {
    const { appointment } = await book("09:00");
    expect(appointment).toMatchObject({ status: "booked", overbooked: false, endsAt: at("09:20") });
    const row = getState().clinicAudit.find((e) => e.action === "appointment.booked")!;
    expect(JSON.stringify(row)).not.toContain(patientOf("active").fullName);
    expect(row.category).toBe("administrative");
  });

  it("refuses outside the hours, in time off and over another appointment; touching is fine", async () => {
    expect(await fails(book("14:00"))).toBe("outside_schedule");
    await book("10:00");
    expect(await fails(book("10:10"))).toBe("appointment_overlap");
    expect((await book("10:20")).appointment?.status).toBe("booked");
    const doctor = memberWith("doctor");
    await api.scheduling.addTimeOff(admin(), doctor.id, {
      startsAt: at("11:00"),
      endsAt: at("12:00"),
      note: null,
    });
    expect(await fails(book("11:30"))).toBe("provider_time_off");
  });

  it("D-3: an overbook holder books over a refused slot; the receptionist may not ask", async () => {
    expect((await book("14:00", { overbook: true })).appointment?.overbooked).toBe(true);
    expect(await fails(book("09:00", { overbook: true }, as("receptionist")))).toBe("forbidden");
  });

  it("refuses an archived file and replays a key", async () => {
    expect(await fails(book("09:00", { patientId: patientOf("archived").id }))).toBe(
      "patient_inactive",
    );
    const key = crypto.randomUUID();
    const first = await api.appointments.create(admin(), body("12:00"), key);
    const again = await api.appointments.create(admin(), body("12:00"), key);
    expect(again.appointment?.id).toBe(first.appointment?.id);
    expect(await fails(api.appointments.create(admin(), body("12:30"), key))).toBe(
      "idempotency_conflict",
    );
  });
});

describe("statuses (D-5, D-11) and reschedule (rule 6)", () => {
  it("follows the table; a cancel keeps its note off the audit", async () => {
    const id = (await book("09:00")).appointment!.id;
    await api.appointments.setStatus(admin(), id, { status: "arrived" });
    expect(await fails(api.appointments.reschedule(admin(), id, moveTo("09:30", "09:50")))).toBe(
      "invalid_transition",
    );
    await api.appointments.cancel(admin(), id, { reason: "other", note: "secret-note" });
    expect(await fails(api.appointments.setStatus(admin(), id, { status: "completed" }))).toBe(
      "invalid_transition",
    );
    expect(JSON.stringify(getState().clinicAudit)).not.toContain("secret-note");
  });

  it("moves a booked appointment through the same checks", async () => {
    const id = (await book("09:00")).appointment!.id;
    await book("10:00");
    expect(await fails(api.appointments.reschedule(admin(), id, moveTo("10:05", "10:15")))).toBe(
      "appointment_overlap",
    );
    const moved = await api.appointments.reschedule(admin(), id, moveTo("11:00", "11:30"));
    expect(moved.appointment?.startsAt).toBe(at("11:00"));
    expect(getState().clinicAudit.some((e) => e.action === "appointment.rescheduled")).toBe(true);
  });
});

describe("the receptionist's branch scope", () => {
  it("sees and books only in its own branches", async () => {
    const receptionist = memberWith("receptionist");
    const branches = (await api.appointments.listBranches(as("receptionist"))).items.map(
      (b) => b.id,
    );
    expect(branches.every((id) => receptionist.branchIds.includes(id))).toBe(true);
    const outside = getState().branches.find(
      (b) => b.clinicId === clinicIdAt(0) && b.isActive && !receptionist.branchIds.includes(b.id),
    );
    if (outside) {
      expect(
        await fails(
          api.appointments.day(as("receptionist"), { branchId: outside.id, date: SUNDAY }),
        ),
      ).toBe("not_found");
      expect(await fails(book("09:00", { branchId: outside.id }, as("receptionist")))).toBe(
        "forbidden",
      );
    }
  });

  it("the day view: providers of the branch with their hours and the live appointments", async () => {
    const doctor = memberWith("doctor");
    await book("09:00");
    const day = await api.appointments.day(admin(), {
      branchId: doctor.branchIds[0]!,
      date: SUNDAY,
    });
    const column = day.providers.find((p) => p.membershipId === doctor.id)!;
    expect(column.shifts).toEqual([
      { startsAt: "09:00", endsAt: "13:00" },
      { startsAt: "17:00", endsAt: "21:00" },
    ]);
    expect(day.appointments.some((a) => a.startsAt === at("09:00"))).toBe(true);
    expect(day.can).toEqual({ create: true, update: true, overbook: true });
  });
});
