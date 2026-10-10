import { isAppointmentLength, resolveAppointmentEnd } from "@eyadex/contracts/appointment-slots";
import {
  appointmentCancelSchema,
  appointmentDaySchema,
  appointmentDayQuerySchema,
  appointmentInputSchema,
  appointmentRescheduleSchema,
  appointmentStatusInputSchema,
  canTransition,
  isReschedulable,
  type AppointmentDay,
  type AppointmentStatus,
} from "@eyadex/contracts/appointments";
import { clinicDayBounds } from "@eyadex/contracts/clinic-time";
import type { z } from "zod";
import { ApiError } from "../api-error";
import type { AppointmentsApi } from "../appointments-client";
import { actorReplayKey } from "./mock-idempotency";
import {
  answer,
  assertMay,
  auditAppointment,
  authorizeAppointments,
  checkTarget,
  project,
  slotProblems,
  type AppointmentAccess,
} from "./mock-appointment-rules";
import { profileOf, reachCovers, worksIn } from "./mock-scheduling-rules";
import {
  delay,
  getState,
  newId,
  persist,
  type MockState,
  type StoredAppointment,
} from "./mock-store";

function parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError("validation");
  return parsed.data;
}

/** An appointment inside the update reach (else not_found, as the API). */
function existing(db: MockState, a: AppointmentAccess, id: string): StoredAppointment {
  const found = db.appointments.find((x) => x.clinicId === a.clinic.id && x.id === id);
  if (!found || !reachCovers(a.reach("update"), found.branchId)) throw new ApiError("not_found");
  return found;
}

/** Rule 2 decided as the API's `decideSlot`: overbook lifts every problem and marks the booking. */
function decide(problems: readonly string[], overbook: boolean): boolean {
  const first = problems[0];
  if (first === undefined) return false;
  if (!overbook) throw new ApiError(first as "outside_schedule");
  return true;
}

function move(
  db: MockState,
  a: AppointmentAccess,
  id: string,
  to: AppointmentStatus,
  cancel: { reason: StoredAppointment["cancelReason"]; note: string | null } | null,
) {
  const found = existing(db, a, id);
  if (found.status === to) return answer(db, a, found);
  if (!canTransition(found.status, to)) throw new ApiError("invalid_transition");
  const before = { ...found };
  found.status = to;
  found.cancelReason = cancel?.reason ?? null;
  found.cancelNote = cancel?.note ?? null;
  const action = to === "cancelled" ? "appointment.cancelled" : "appointment.status_changed";
  auditAppointment(db, a, action, before, found);
  persist();
  return answer(db, a, found);
}

function day(db: MockState, a: AppointmentAccess, query: { branchId: string; date: string }) {
  const clinicId = a.clinic.id;
  const branch = db.branches.find((b) => b.clinicId === clinicId && b.id === query.branchId);
  if (!branch || !reachCovers(a.reach("view"), branch.id)) throw new ApiError("not_found");
  const tz = a.clinic.timezone;
  const span = clinicDayBounds(query.date, tz);
  const inDay = (x: { startsAt: string; endsAt: string }) =>
    Date.parse(x.startsAt) < Date.parse(span.endsAt) &&
    Date.parse(x.endsAt) > Date.parse(span.startsAt);
  const rows = db.appointments
    .filter(
      (x) =>
        x.clinicId === clinicId && x.branchId === branch.id && x.status !== "cancelled" && inDay(x),
    )
    .sort((x, y) => x.startsAt.localeCompare(y.startsAt) || x.id.localeCompare(y.id));
  const weekday = new Date(`${query.date}T00:00:00Z`).getUTCDay();
  const members = db.members.filter(
    (m) =>
      m.clinicId === clinicId &&
      ((m.status === "active" &&
        profileOf(db, m.id).acceptsAppointments &&
        worksIn(m, branch.id)) ||
        rows.some((r) => r.providerMembershipId === m.id)),
  );
  const providers = members
    .map((m) => ({
      membershipId: m.id,
      fullName: m.fullName,
      defaultDurationMinutes: profileOf(db, m.id).defaultDurationMinutes,
      bookable:
        m.status === "active" && profileOf(db, m.id).acceptsAppointments && worksIn(m, branch.id),
      shifts: db.scheduleRows
        .filter((r) => r.membershipId === m.id && r.branchId === branch.id && r.weekday === weekday)
        .sort((x, y) => x.startsAt.localeCompare(y.startsAt))
        .map((r) => ({ startsAt: r.startsAt, endsAt: r.endsAt })),
      timeOff: db.timeOff
        .filter((t) => t.membershipId === m.id && t.cancelledAt === null && inDay(t))
        .map((t) => ({ startsAt: t.startsAt, endsAt: t.endsAt })),
    }))
    .sort(
      (x, y) =>
        x.fullName.localeCompare(y.fullName) || x.membershipId.localeCompare(y.membershipId),
    );
  const create = branch.isActive && reachCovers(a.reach("create"), branch.id);
  const update = reachCovers(a.reach("update"), branch.id);
  const result: AppointmentDay = {
    branch: {
      id: branch.id,
      nameAr: branch.nameAr,
      nameEn: branch.nameEn,
      isActive: branch.isActive,
    },
    date: query.date,
    timezone: tz,
    providers,
    appointments: rows.map((r) => project(db, r)),
    can: {
      create,
      update,
      overbook: (create || update) && reachCovers(a.reach("overbook"), branch.id),
    },
  };
  return appointmentDaySchema.parse(result);
}

/** The mock of `/v1/appointments*`: the API's check order and rules (slice A2, ADR-0026 §11). */
export function createMockAppointments(): AppointmentsApi {
  return {
    async listBranches(persona) {
      await delay();
      const db = getState();
      const a = authorizeAppointments(db, persona, "view");
      const items = db.branches
        .filter(
          (b) => b.clinicId === a.clinic.id && b.isActive && reachCovers(a.reach("view"), b.id),
        )
        .map((b) => ({ id: b.id, nameAr: b.nameAr, nameEn: b.nameEn, isActive: b.isActive }));
      return { items };
    },
    async day(persona, rawQuery) {
      await delay();
      const db = getState();
      const a = authorizeAppointments(db, persona, "view");
      return day(db, a, parse(appointmentDayQuerySchema, rawQuery));
    },
    async create(persona, raw, idempotencyKey) {
      await delay();
      const db = getState();
      const a = authorizeAppointments(db, persona, "create");
      const input = parse(appointmentInputSchema, raw);
      assertMay(a, "create", input.branchId, input.overbook);
      const ledger = (db.idempotentAppointments ??= {});
      const replayKey = actorReplayKey(a.clinic.id, a.member.id, idempotencyKey);
      const fingerprint = JSON.stringify(input);
      const previous = ledger[replayKey];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ApiError("idempotency_conflict");
        const stored = db.appointments.find((x) => x.id === previous.appointmentId);
        if (stored) return answer(db, a, stored);
      }
      const { profile, service } = checkTarget(db, a.clinic.id, {
        providerId: input.providerMembershipId,
        branchId: input.branchId,
        patientId: input.patientId,
        serviceId: input.serviceId,
      });
      const startsAt = new Date(input.startsAt).toISOString();
      const endsAt = resolveAppointmentEnd(
        startsAt,
        input.endsAt,
        service?.durationMinutes ?? null,
        profile.defaultDurationMinutes,
      );
      if (!isAppointmentLength(startsAt, endsAt)) throw new ApiError("validation");
      const target = { providerId: input.providerMembershipId, branchId: input.branchId };
      const overbooked = decide(
        slotProblems(db, a, target, { startsAt, endsAt }, null),
        input.overbook,
      );
      const stored: StoredAppointment = {
        id: newId(),
        clinicId: a.clinic.id,
        branchId: input.branchId,
        patientId: input.patientId,
        providerMembershipId: input.providerMembershipId,
        serviceId: service?.id ?? null,
        startsAt,
        endsAt,
        status: "booked",
        overbooked,
        cancelReason: null,
        cancelNote: null,
        createdAt: new Date().toISOString(),
      };
      db.appointments.push(stored);
      ledger[replayKey] = { appointmentId: stored.id, fingerprint };
      auditAppointment(db, a, "appointment.booked", null, stored);
      persist();
      return answer(db, a, stored);
    },
    async reschedule(persona, id, raw) {
      await delay();
      const db = getState();
      const a = authorizeAppointments(db, persona, "update");
      const input = parse(appointmentRescheduleSchema, raw);
      assertMay(a, "update", input.branchId, input.overbook);
      const found = existing(db, a, id);
      if (!isReschedulable(found.status)) throw new ApiError("invalid_transition");
      const startsAt = new Date(input.startsAt).toISOString();
      const endsAt = new Date(input.endsAt).toISOString();
      const same =
        found.branchId === input.branchId &&
        found.providerMembershipId === input.providerMembershipId &&
        found.startsAt === startsAt &&
        found.endsAt === endsAt;
      if (same) return answer(db, a, found);
      const target = { providerId: input.providerMembershipId, branchId: input.branchId };
      checkTarget(db, a.clinic.id, { ...target, patientId: found.patientId, serviceId: null });
      const overbooked = decide(
        slotProblems(db, a, target, { startsAt, endsAt }, id),
        input.overbook,
      );
      const before = { ...found };
      Object.assign(found, {
        branchId: input.branchId,
        providerMembershipId: input.providerMembershipId,
        startsAt,
        endsAt,
        overbooked,
      });
      auditAppointment(db, a, "appointment.rescheduled", before, found);
      persist();
      return answer(db, a, found);
    },
    async setStatus(persona, id, raw) {
      await delay();
      const db = getState();
      const a = authorizeAppointments(db, persona, "update");
      const input = parse(appointmentStatusInputSchema, raw);
      return move(db, a, id, input.status, null);
    },
    async cancel(persona, id, raw) {
      await delay();
      const db = getState();
      const a = authorizeAppointments(db, persona, "update");
      const input = parse(appointmentCancelSchema, raw);
      const note = input.note === null || input.note === "" ? null : input.note;
      return move(db, a, id, "cancelled", { reason: input.reason, note });
    },
  };
}
