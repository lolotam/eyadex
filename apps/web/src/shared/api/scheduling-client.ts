import type { Page } from "@eyadex/contracts/common";
import type {
  BranchScheduleInput,
  ProviderSchedule,
  ProviderSummary,
  ScheduleWriteResponse,
  TimeOffInput,
} from "@eyadex/contracts/schedules";
import type {
  BookingProfile,
  BookingProfileInput,
  ClinicService,
  ServiceInput,
  ServiceListQuery,
} from "@eyadex/contracts/services";
import type { Persona } from "@eyadex/contracts/session";

/**
 * The appointments module's settings (slice A1, ADR-0026). Every call is rejected with
 * module_disabled while the clinic's appointments module is off.
 */
export interface SchedulingApi {
  /** view:services:clinic. */
  listServices(persona: Persona, query: ServiceListQuery): Promise<Page<ClinicService>>;
  /** A retry with the same key replays the first result; a changed request is a conflict. */
  createService(
    persona: Persona,
    input: ServiceInput,
    idempotencyKey: string,
  ): Promise<ClinicService>;
  updateService(persona: Persona, serviceId: string, input: ServiceInput): Promise<ClinicService>;
  deactivateService(persona: Persona, serviceId: string): Promise<ClinicService>;
  reactivateService(persona: Persona, serviceId: string): Promise<ClinicService>;
  /** The user editor's booking settings: view:users:clinic to read, update:users:clinic to save. */
  getBookingProfile(persona: Persona, memberId: string): Promise<BookingProfile>;
  setBookingProfile(
    persona: Persona,
    memberId: string,
    input: BookingProfileInput,
  ): Promise<BookingProfile>;
  /** Bookable members working in at least one branch the caller's schedules view reaches. */
  listProviders(persona: Persona): Promise<ProviderSummary[]>;
  getProviderSchedule(persona: Persona, membershipId: string): Promise<ProviderSchedule>;
  /**
   * Replaces the provider's whole week in one branch (update:schedules at that branch). A dormant
   * branch (inactive, or the provider left it) takes only an empty week, which clears its rows.
   * schedule_overlap names the conflicting branch in details.branchId when it is inside the reach.
   * Every write answers with the schedule as the caller's view keys show it, or `schedule: null`
   * when those keys cannot see the provider (refetch instead of reading the answer).
   */
  replaceBranchSchedule(
    persona: Persona,
    membershipId: string,
    branchId: string,
    input: BranchScheduleInput,
  ): Promise<ScheduleWriteResponse>;
  /** update:schedules:clinic. */
  addTimeOff(
    persona: Persona,
    membershipId: string,
    input: TimeOffInput,
  ): Promise<ScheduleWriteResponse>;
  cancelTimeOff(
    persona: Persona,
    membershipId: string,
    timeOffId: string,
  ): Promise<ScheduleWriteResponse>;
}
