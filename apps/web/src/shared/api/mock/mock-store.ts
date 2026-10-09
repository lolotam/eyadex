import type { Clinic, ClinicFeatures, CreatedClinic } from "@eyadex/contracts/clinics";
import type { InvitationRecord } from "@eyadex/contracts/invitations";
import type { Branch, ClinicAuditEntry, Role } from "@eyadex/contracts/organization";
import type { Patient } from "@eyadex/contracts/patients";
import type { PlatformAccount, PlatformSettings } from "@eyadex/contracts/platform";
import type { ScheduleShift, TimeOff } from "@eyadex/contracts/schedules";
import type { BookingProfileInput, ClinicService } from "@eyadex/contracts/services";
import type { PlatformAuditEntry } from "@eyadex/contracts/session";
import type { MembershipUser } from "@eyadex/contracts/users";
import { buildSeed } from "./seed";

export type StoredService = ClinicService & { clinicId: string };
export type StoredShift = ScheduleShift & { clinicId: string; id: string; membershipId: string };
export type StoredTimeOff = TimeOff & {
  clinicId: string;
  membershipId: string;
  cancelledAt: string | null;
};

export type MockState = {
  clinics: Clinic[];
  features: Record<string, ClinicFeatures>;
  branches: Branch[];
  roles: Role[];
  members: MembershipUser[];
  invitations: InvitationRecord[];
  /** Mock stand-in for the invitation email: invitation id -> latest plain link token. */
  inviteOutbox: Record<string, string>;
  /**
   * Idempotency-Key replay ledgers (optional for older saved state). Clinic writes are keyed
   * "clinicId:actorMemberId:key" (`actorReplayKey`), clinic creates "platformAccountId:key".
   * Invitations: key -> invitation id + request fingerprint.
   */
  idempotentInvites?: Record<string, { invitationId: string; fingerprint: string }>;
  /** Idempotency-Key replay for branch creates, as above: key -> branch id + request fingerprint. */
  idempotentBranches?: Record<string, { branchId: string; fingerprint: string }>;
  idempotentRoles?: Record<string, { roleId: string; fingerprint: string }>; // role creates, as above
  /** Idempotency-Key replay for clinic creates, as above: key -> the first answer + fingerprint. */
  idempotentClinics?: Record<string, { created: CreatedClinic; fingerprint: string }>;
  patients: Patient[];
  /** Idempotency-Key replay for patient creates, as above: key -> patient id + request fingerprint. */
  idempotentPatients?: Record<string, { patientId: string; fingerprint: string }>;
  /** Per-clinic file-number counter: last number issued, never reused. */
  patientCounters: Record<string, number>;
  /** Appointments module (slice A1, ADR-0026). */
  services: StoredService[];
  /** Idempotency-Key replay for service creates, as above: key -> service id + request fingerprint. */
  idempotentServices?: Record<string, { serviceId: string; fingerprint: string }>;
  /** By member id; a member with no entry is not bookable, 20 minutes (D-15). */
  bookingProfiles: Record<string, BookingProfileInput>;
  scheduleRows: StoredShift[];
  timeOff: StoredTimeOff[];
  platformAccounts: PlatformAccount[];
  platformSettings: PlatformSettings;
  platformAudit: PlatformAuditEntry[];
  clinicAudit: ClinicAuditEntry[];
};

const STORAGE_KEY = "eyadex:mock-db:v15";
/** Shared with the persona provider by name only (screens never import the mock). */
const PERSONA_STORAGE_KEY = "eyadex:persona";
const MOCK_RESET_EVENT = "eyadex:mock-reset";

let state: MockState | null = null;

export function getState(): MockState {
  if (state) return state;
  if (typeof window !== "undefined") {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        state = JSON.parse(raw) as MockState;
        return state;
      } catch {
        // fall through to fresh seed
      }
    }
  }
  state = buildSeed();
  persist();
  if (typeof window !== "undefined") {
    // A new data version reseeds every id: a saved persona would point at records that no
    // longer exist. Drop it and tell the persona provider to fall back to the default.
    window.localStorage.removeItem(PERSONA_STORAGE_KEY);
    window.dispatchEvent(new Event(MOCK_RESET_EVENT));
  }
  return state;
}

export function persist(): void {
  if (typeof window === "undefined" || !state) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetMockData(): void {
  state = buildSeed();
  persist();
}

export function delay(ms = 180): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function newId(): string {
  return crypto.randomUUID();
}
