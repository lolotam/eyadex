import type { CreateClinicInput, CreatedClinic } from "@eyadex/contracts/clinics";
import { ApiError } from "../api-error";
import type { MockState } from "./mock-store";

/** The same key must carry the same request: a changed one is a conflict, never the old answer. */
function fingerprintOf(input: CreateClinicInput): string {
  return JSON.stringify({ ...input, adminEmail: input.adminEmail.trim().toLowerCase() });
}

/** The first answer for this key, or null when the key is new. */
export function replayClinicCreate(
  db: MockState,
  key: string,
  input: CreateClinicInput,
): CreatedClinic | null {
  const previous = db.idempotentClinics?.[key];
  if (!previous) return null;
  if (previous.fingerprint !== fingerprintOf(input)) throw new ApiError("idempotency_conflict");
  return previous.created;
}

export function rememberClinicCreate(
  db: MockState,
  key: string,
  input: CreateClinicInput,
  created: CreatedClinic,
): void {
  db.idempotentClinics = {
    ...db.idempotentClinics,
    [key]: { created, fingerprint: fingerprintOf(input) },
  };
}
