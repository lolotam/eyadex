import type {
  AppointmentBranches,
  AppointmentCancelInput,
  AppointmentDay,
  AppointmentDayQuery,
  AppointmentInput,
  AppointmentRescheduleInput,
  AppointmentStatusInput,
  AppointmentWriteResponse,
} from "@eyadex/contracts/appointments";
import type { Persona } from "@eyadex/contracts/session";

/**
 * Appointments (slice A2, ADR-0026 §11). Every call is rejected with module_disabled while the clinic's
 * appointments module is off. Every write answers with the appointment as the caller's
 * `view:appointments` keys show it, or `appointment: null` (refetch the day instead).
 */
export interface AppointmentsApi {
  /** The active branches the caller's view:appointments keys reach. */
  listBranches(persona: Persona): Promise<AppointmentBranches>;
  /** One branch, one clinic-calendar date: provider columns, their hours, the live appointments. */
  day(persona: Persona, query: AppointmentDayQuery): Promise<AppointmentDay>;
  /** A retry with the same key replays the first result; a changed request is a conflict. */
  create(
    persona: Persona,
    input: AppointmentInput,
    idempotencyKey: string,
  ): Promise<AppointmentWriteResponse>;
  /** A booked appointment only; the same checks as a booking (rule 6). */
  reschedule(
    persona: Persona,
    appointmentId: string,
    input: AppointmentRescheduleInput,
  ): Promise<AppointmentWriteResponse>;
  setStatus(
    persona: Persona,
    appointmentId: string,
    input: AppointmentStatusInput,
  ): Promise<AppointmentWriteResponse>;
  cancel(
    persona: Persona,
    appointmentId: string,
    input: AppointmentCancelInput,
  ): Promise<AppointmentWriteResponse>;
}
