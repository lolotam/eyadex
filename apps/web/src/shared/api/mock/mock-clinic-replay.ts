import type { CreateClinicInput, CreatedClinic } from "@eyadex/contracts/clinics";
import { ApiError } from "../api-error";
import type { NewClinicFinance } from "../new-clinic-finance";
import type { MockState } from "./mock-store";

/** The same key must carry the same request: a changed one is a conflict, never the old answer. */
function fingerprintOf(input: CreateClinicInput, finance: NewClinicFinance): string {
  return JSON.stringify({
    ...input,
    adminEmail: input.adminEmail.trim().toLowerCase(),
    currency: finance.currency ?? "KWD",
    taxRateBp: finance.taxRateBp ?? 0,
  });
}

/**
 * Scoped by the platform account like the API (`platform:create-clinic:<userId>`): two accounts
 * never share a key. Entries saved before this scope (the bare key) never match it.
 */
const ledgerKey = (accountId: string, key: string) => `${accountId}:${key}`;

/**
 * The first answer for this key, or null when the key is new. The clinic comes back as it is now,
 * as the HTTP adapter reads it back after the API replays the stored ids.
 */
export function replayClinicCreate(
  db: MockState,
  accountId: string,
  key: string,
  input: CreateClinicInput,
  finance: NewClinicFinance,
): CreatedClinic | null {
  const previous = db.idempotentClinics?.[ledgerKey(accountId, key)];
  if (!previous) return null;
  if (previous.fingerprint !== fingerprintOf(input, finance))
    throw new ApiError("idempotency_conflict");
  const clinic = db.clinics.find((c) => c.id === previous.created.clinic.id);
  if (!clinic) throw new ApiError("not_found");
  return { clinic, firstAdminInvite: previous.created.firstAdminInvite };
}

export function rememberClinicCreate(
  db: MockState,
  accountId: string,
  key: string,
  input: CreateClinicInput,
  finance: NewClinicFinance,
  created: CreatedClinic,
): void {
  db.idempotentClinics = {
    ...db.idempotentClinics,
    [ledgerKey(accountId, key)]: { created, fingerprint: fingerprintOf(input, finance) },
  };
}
