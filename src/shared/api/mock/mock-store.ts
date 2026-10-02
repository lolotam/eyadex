import type { Clinic, ClinicFeatures } from "@contracts/clinics";
import type { Branch, ClinicAuditEntry, Invitation, Member, Role } from "@contracts/organization";
import type { Patient } from "@contracts/patients";
import type { PlatformAuditEntry } from "@contracts/session";
import { buildSeed } from "./seed";

export type MockState = {
  clinics: Clinic[];
  features: Record<string, ClinicFeatures>;
  branches: Branch[];
  roles: Role[];
  members: Member[];
  invitations: Invitation[];
  patients: Patient[];
  platformAudit: PlatformAuditEntry[];
  clinicAudit: ClinicAuditEntry[];
};

const STORAGE_KEY = "clinic-app:mock-db:v1";

let state: MockState | null = null;

export function getState(): MockState {
  if (state) return state;
  if (typeof window !== "undefined") {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        state = JSON.parse(raw) as MockState;
        state.clinicAudit ??= [];
        state.branches = state.branches.map((branch) => ({ ...branch, address: branch.address ?? null, phone: branch.phone ?? null }));
        return state;
      } catch {
        // fall through to fresh seed
      }
    }
  }
  state = buildSeed();
  persist();
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
