import type { Clinic, ClinicFeatures } from "@contracts/clinics";
import type { InvitationRecord } from "@contracts/invitations";
import type { Branch, ClinicAuditEntry, Role } from "@contracts/organization";
import type { Patient } from "@contracts/patients";
import type { PlatformAccount, PlatformSettings } from "@contracts/platform";
import type { PlatformAuditEntry } from "@contracts/session";
import type { MembershipUser } from "@contracts/users";
import { buildSeed } from "./seed";

export type MockState = {
  clinics: Clinic[];
  features: Record<string, ClinicFeatures>;
  branches: Branch[];
  roles: Role[];
  members: MembershipUser[];
  invitations: InvitationRecord[];
  /** Mock stand-in for the invitation email: invitation id -> latest plain link token. */
  inviteOutbox: Record<string, string>;
  /** Idempotency-Key replay: "clinicId:key" -> invitation id (optional for older saved state). */
  idempotentInvites?: Record<string, { invitationId: string; fingerprint: string }>;
  patients: Patient[];
  /** Idempotency-Key replay for patient creates: "clinicId:key" -> patient id + request fingerprint. */
  idempotentPatients?: Record<string, { patientId: string; fingerprint: string }>;
  /** Per-clinic file-number counter: last number issued, never reused. */
  patientCounters: Record<string, number>;
  platformAccounts: PlatformAccount[];
  platformSettings: PlatformSettings;
  platformAudit: PlatformAuditEntry[];
  clinicAudit: ClinicAuditEntry[];
};

const STORAGE_KEY = "eyadex:mock-db:v12";
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
