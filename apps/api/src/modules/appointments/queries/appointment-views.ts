import type { Appointment, AppointmentWriteResponse } from "@eyadex/contracts/appointments";
import type { Tx } from "@eyadex/db";

import { actorViewReach, viewSees, type AppointmentActor } from "../domain/booking-rules.ts";
import {
  findAppointment,
  servicesOf,
  type AppointmentRow,
} from "../persistence/pg-appointment-store.ts";
import type { BookingPatientReader } from "../ports/booking-patient-reader.ts";
import type { ProviderDirectory } from "../ports/provider-directory.ts";

/** What an appointments read needs: the transaction and the ports that name people. */
export interface AppointmentReads {
  readonly tx: Tx;
  readonly providers: ProviderDirectory;
  readonly patients: BookingPatientReader;
}

/**
 * Stored rows as the contract's appointments: provider names through `ProviderDirectory`, patient names
 * and file numbers through `BookingPatientReader` (never a phone or civil ID), service names.
 *
 * @param reads the transaction and ports
 * @param clinicId the clinic
 * @param rows the stored appointments
 * @returns the appointments, in the rows' order
 */
export async function projectAppointments(
  reads: AppointmentReads,
  clinicId: string,
  rows: readonly AppointmentRow[],
): Promise<Appointment[]> {
  const { tx, providers, patients } = reads;
  const names = await providers.findMany(
    tx,
    clinicId,
    rows.map((r) => r.providerMembershipId),
  );
  const labels = await patients.labels(
    tx,
    clinicId,
    rows.map((r) => r.patientId),
  );
  const services = await servicesOf(
    tx,
    clinicId,
    rows.flatMap((r) => (r.serviceId === null ? [] : [r.serviceId])),
  );
  return rows.map((r) => {
    const patient = labels.get(r.patientId);
    const service = r.serviceId === null ? undefined : services.get(r.serviceId);
    return {
      id: r.id,
      branchId: r.branchId,
      providerMembershipId: r.providerMembershipId,
      providerName: names.get(r.providerMembershipId)?.fullName ?? "",
      patientId: r.patientId,
      patientName: patient?.fullName ?? "",
      patientFileNumber: patient?.fileNumber ?? 0,
      serviceId: r.serviceId,
      serviceNameAr: service?.nameAr ?? null,
      serviceNameEn: service?.nameEn ?? null,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      status: r.status,
      overbooked: r.overbooked,
      cancelReason: r.cancelReason,
      cancelNote: r.cancelNote,
    };
  });
}

/**
 * The answer of every appointments write: the appointment as the caller's `view:appointments` keys show
 * it, or `null` when they do not reach its branch — or, under `own` only, when its provider is not the
 * caller (ADR-0026 A3): a write never shows more than a read (ADR-0026 §11).
 *
 * @param reads the transaction and ports
 * @param actor the caller
 * @param id the appointment
 * @returns the answer
 */
export async function appointmentAnswer(
  reads: AppointmentReads,
  actor: AppointmentActor,
  id: string,
): Promise<AppointmentWriteResponse> {
  const row = await findAppointment(reads.tx, actor.clinicId, id);
  if (row === null || !viewSees(actorViewReach(actor), row)) {
    return { appointment: null };
  }
  const [appointment] = await projectAppointments(reads, actor.clinicId, [row]);
  return { appointment: appointment ?? null };
}
