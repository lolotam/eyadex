import {
  appointmentSlotProblems,
  type SlotProblem,
  type TimeSpan,
} from "@eyadex/contracts/appointment-slots";
import type { Database, Tx } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";

import { writeClinicAudit } from "../../../shared/clinic-audit.ts";
import { ApiError } from "../../../shared/errors.ts";
import { lockProviders } from "../../../shared/provider-lock.ts";
import type { Clock } from "../../tenancy/index.ts";
import {
  appointmentAuditSnapshot,
  type AppointmentActor,
  type AppointmentAuditFields,
} from "../domain/booking-rules.ts";
import { providerWorksIn, reachCovers, type Reach } from "../domain/scheduling-scope.ts";
import {
  findAppointment,
  lockService,
  providerBusy,
  servicesOf,
  type AppointmentRow,
  type BookingService,
} from "../persistence/pg-appointment-store.ts";
import { readScheduleRows, readTimeOffOverlapping } from "../persistence/pg-schedule-store.ts";
import type { AppointmentNotifications } from "../ports/appointment-notifications.ts";
import type { BookingPatientReader } from "../ports/booking-patient-reader.ts";
import type { ProviderDirectory, ProviderRecord } from "../ports/provider-directory.ts";
import type { SchedulingBranchReader } from "../ports/scheduling-branch-reader.ts";

// The steps the booking and status use cases share, each at its place in the lock order of ADR-0027:
// provider locks → the appointment row → the membership row → a patient row → a branch row → a service row.

export interface AppointmentDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly providers: ProviderDirectory;
  readonly branches: SchedulingBranchReader;
  readonly patients: BookingPatientReader;
  /** Patient messages (notifications' ledger behind the module's port, ADR-0031). */
  readonly notifications: AppointmentNotifications;
}

/** Where a booking goes: the provider, the branch, and on a create the patient and the service. */
export interface BookingTarget {
  readonly providerId: string;
  readonly branchId: string;
  readonly patientId: string | null;
  readonly serviceId: string | null;
}

/**
 * Rules 1 and 7 and the hard checks overbook never lifts, with every row locked in order: the provider is
 * an active member accepting appointments, the patient's file is active, the branch is active and the
 * provider works there, the service is active.
 *
 * @returns the provider and the service (null without one)
 */
export async function lockTarget(
  tx: Tx,
  deps: AppointmentDeps,
  clinicId: string,
  target: BookingTarget,
): Promise<{ provider: ProviderRecord; service: BookingService | null }> {
  const provider = await deps.providers.lockForWrite(tx, clinicId, target.providerId);
  if (provider === null) throw new ApiError("not_found");
  if (!provider.active || !provider.acceptsAppointments)
    throw new ApiError("provider_not_bookable");
  if (target.patientId !== null) {
    const patient = await deps.patients.lockForBooking(tx, clinicId, target.patientId);
    if (patient === null) throw new ApiError("not_found");
    if (!patient.active) throw new ApiError("patient_inactive");
  }
  const branch = await deps.branches.lockForFiling(tx, clinicId, target.branchId);
  if (branch === null) throw new ApiError("not_found");
  if (!branch.isActive) throw new ApiError("branch_inactive");
  if (!providerWorksIn(provider, target.branchId)) throw new ApiError("provider_not_in_branch");
  if (target.serviceId === null) return { provider, service: null };
  const service = await lockService(tx, clinicId, target.serviceId);
  if (service === null) throw new ApiError("not_found");
  if (!service.active) throw new ApiError("service_inactive");
  return { provider, service };
}

/**
 * Rule 2 on rows read under the provider lock: the provider's rows in THIS branch (D-6, D-14), its time
 * off, its other live appointments in every branch.
 *
 * @returns the failed checks in order; `[]` = free
 */
export async function slotProblems(
  tx: Tx,
  actor: AppointmentActor,
  target: Pick<BookingTarget, "providerId" | "branchId">,
  span: TimeSpan,
  exceptId: string | null,
): Promise<SlotProblem[]> {
  const { clinicId } = actor;
  const rows = (await readScheduleRows(tx, clinicId, target.providerId)).filter(
    (r) => r.branchId === target.branchId,
  );
  const timeOff = await readTimeOffOverlapping(tx, clinicId, target.providerId, span);
  const busy = await providerBusy(tx, clinicId, target.providerId, span, exceptId);
  return appointmentSlotProblems(span, actor.timezone, rows, timeOff, busy);
}

/** The appointment moved to another provider between the first read and its provider's lock. */
export class AppointmentMoved extends Error {}

/**
 * An existing appointment inside `reach` (else `not_found`, like a file outside a patient scope), with
 * its provider locked (and `alsoLock`, a reschedule's new provider) BEFORE its row is locked. If a
 * concurrent reschedule moved it to another provider meanwhile, the transaction must start over
 * (`AppointmentMoved`, see `retryWhenMoved`): taking that provider's lock now, while holding the row,
 * would break the order of ADR-0027 (Codex A2 r1).
 *
 * @returns the row, `FOR UPDATE`
 */
export async function lockExisting(
  tx: Tx,
  clinicId: string,
  id: string,
  reach: Reach,
  alsoLock: readonly string[] = [],
): Promise<AppointmentRow> {
  const seen = await findAppointment(tx, clinicId, id);
  if (seen === null || !reachCovers(reach, seen.branchId)) throw new ApiError("not_found");
  await lockProviders(tx, clinicId, [seen.providerMembershipId, ...alsoLock]);
  const row = await findAppointment(tx, clinicId, id, true);
  if (row === null || !reachCovers(reach, row.branchId)) throw new ApiError("not_found");
  if (row.providerMembershipId !== seen.providerMembershipId) throw new AppointmentMoved();
  return row;
}

/**
 * Runs a transaction again (at most three times) when it found its appointment moved: the rollback
 * releases every lock, and the next attempt reads the new provider first.
 *
 * @param run one whole transaction
 * @returns its result
 */
export async function retryWhenMoved<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof AppointmentMoved)) throw error;
      if (attempt === 3) throw new ApiError("unknown");
    }
  }
}

/** The audit fields of a stored appointment (provider and service names resolved). */
export async function auditFieldsOf(
  tx: Tx,
  deps: AppointmentDeps,
  clinicId: string,
  row: AppointmentRow,
): Promise<AppointmentAuditFields> {
  const provider = await deps.providers.find(tx, clinicId, row.providerMembershipId);
  const service =
    row.serviceId === null
      ? undefined
      : (await servicesOf(tx, clinicId, [row.serviceId])).get(row.serviceId);
  return {
    providerName: provider?.fullName ?? "",
    branchId: row.branchId,
    serviceNameAr: service?.nameAr ?? null,
    serviceNameEn: service?.nameEn ?? null,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    overbooked: row.overbooked,
    cancelReason: row.cancelReason,
  };
}

/** Rule 9: one administrative clinic row (entity `appointment`), allowlisted snapshots only. */
export async function writeAppointmentAudit(
  tx: Tx,
  deps: AppointmentDeps,
  actor: AppointmentActor,
  action: string,
  appointmentId: string,
  change: { before: AppointmentAuditFields | null; after: AppointmentAuditFields },
): Promise<void> {
  await writeClinicAudit(tx, {
    clinicId: actor.clinicId,
    id: deps.ids.newId(),
    actorUserId: actor.userId,
    action,
    entityType: "appointment",
    entityId: appointmentId,
    details: {
      before: change.before === null ? null : appointmentAuditSnapshot(change.before),
      after: appointmentAuditSnapshot(change.after),
    },
    createdAt: deps.clock.now(),
  });
}
