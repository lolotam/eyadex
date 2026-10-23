import type { FinanceMockState } from "./mock-finance-state";
import type { PaymentMockState } from "./mock-payment-state";
import type { ClosingMockState } from "./mock-cash-closing-state";
import type { AppointmentStatus, CancelReason } from "@eyadex/contracts/appointments";
import type { Clinic, ClinicFeatures, CreatedClinic } from "@eyadex/contracts/clinics";
import type { InvitationRecord } from "@eyadex/contracts/invitations";
import type { Branch, ClinicAuditEntry, Role } from "@eyadex/contracts/organization";
import type { Patient } from "@eyadex/contracts/patients";
import type { PlatformAccount, PlatformSettings } from "@eyadex/contracts/platform";
import type { ScheduleShift, TimeOff } from "@eyadex/contracts/schedules";
import type { BookingProfileInput, ClinicService } from "@eyadex/contracts/services";
import type { PlatformAuditEntry } from "@eyadex/contracts/session";
import type { MembershipUser } from "@eyadex/contracts/users";
import type { MedicalState } from "./mock-medical-state";
import type { NotificationState } from "./mock-notification-state";
import type { StoredWhatsappChannel } from "./mock-whatsapp-state";
import { buildSeed } from "./seed";
import { seedFinanceDemo } from "./seed-finance";

export type StoredService = ClinicService & { clinicId: string };
export type StoredShift = ScheduleShift & { clinicId: string; id: string; membershipId: string };
export type StoredTimeOff = TimeOff & {
  clinicId: string;
  membershipId: string;
  cancelledAt: string | null;
};

/** An appointment as the mock stores it (slice A2): ids only, names are read at projection time. */
export type StoredAppointment = {
  id: string;
  clinicId: string;
  branchId: string;
  patientId: string;
  providerMembershipId: string;
  serviceId: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  overbooked: boolean;
  cancelReason: CancelReason | null;
  cancelNote: string | null;
  createdAt: string;
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
  /** Slice A2. */
  appointments: StoredAppointment[];
  /** Idempotency-Key replay for bookings, as above: key -> appointment id + request fingerprint. */
  idempotentAppointments?: Record<string, { appointmentId: string; fingerprint: string }>;
  /** P2: visits, medical files, medicines and attachments. */
  medical: MedicalState;
  /** Phase 3 N1: notification settings, mail providers and the message ledger (created on use). */
  notifications?: NotificationState;
  /** Phase 3 N2: each clinic's WhatsApp channel (created on use). */
  whatsapp?: { channels: Record<string, StoredWhatsappChannel>; unavailable?: boolean };
  /** Phase 4 F1: prices, finance details, prefixes and invoices (created on use). */
  finance?: FinanceMockState;
  /** Phase 4 F2: payments, allocations, patient credit, receipt and drawer counters (created on use). */
  payments?: PaymentMockState;
  /** Phase 4 F2 card 2b: the branch cash closings and their drawer marks (created on use). */
  cashClosings?: ClosingMockState;
  platformAccounts: PlatformAccount[];
  platformSettings: PlatformSettings;
  platformAudit: PlatformAuditEntry[];
  /** As the API's rows: a medical read about no single record (the walk-in search) names none. */
  clinicAudit: (Omit<ClinicAuditEntry, "entityId"> & { entityId: string | null })[];
};

const STORAGE_KEY = "eyadex:mock-db:v22";
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
  state = freshState();
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

/**
 * The demo's first open also gets some money (F2 card 1 §6), built through the mock's own writes. The test
 * runner starts from the plain seed, so every F1 and F2 test keeps its numbering from 000001.
 */
function freshState(): MockState {
  const seeded = buildSeed();
  if (import.meta.env.MODE !== "test") seedFinanceDemo(seeded);
  return seeded;
}

export function resetMockData(): void {
  state = freshState();
  persist();
}

export function delay(ms = 180): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function newId(): string {
  return crypto.randomUUID();
}
