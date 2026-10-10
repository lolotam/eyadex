import type { ClinicAuditEntry } from "@eyadex/contracts/organization";
import { scrubAuditText, scrubAuditValue } from "@eyadex/observability/audit-text";
import { newId, type MockState } from "./mock-store";

type Snapshot = { id: string } & Record<string, unknown>;

// An id no longer found keeps the API's shape (ADR-0019): the id with null names.
const unnamed = (id: unknown) => (typeof id === "string" ? { id, nameAr: null, nameEn: null } : id);

/** Reference fields stored with the names they had at write time (history never changes). */
const ROLE_REFS = new Set(["roleId"]);
const BRANCH_REFS = new Set(["branchId", "branchIds", "registrationBranchId"]);

function withNames(db: MockState, clinicId: string, snap: Snapshot): Record<string, unknown> {
  const role = (id: unknown) => {
    const r = db.roles.find((x) => x.clinicId === clinicId && x.id === id);
    return r ? { id: r.id, nameAr: r.nameAr, nameEn: r.nameEn } : unnamed(id);
  };
  const branch = (id: unknown) => {
    const b = db.branches.find((x) => x.clinicId === clinicId && x.id === id);
    return b ? { id: b.id, nameAr: b.nameAr, nameEn: b.nameEn } : unnamed(id);
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(structuredClone(snap))) {
    const map = ROLE_REFS.has(key) ? role : BRANCH_REFS.has(key) ? branch : null;
    out[key] = map ? (Array.isArray(value) ? value.map(map) : map(value)) : value;
  }
  return out;
}

// The API's own scrub (one implementation, so the rules cannot drift): a row is append-only, so a civil ID
// or a phone typed into a name must never reach it — the resolved reference names included.
const scrubbed = (snap: Record<string, unknown>) =>
  scrubAuditValue(snap) as Record<string, unknown>;

// P2 R3-4: every medical row is patient access, like the patient file itself; only the clinic
// medicines list stays administrative.
const PATIENT_ACCESS: ReadonlySet<string> = new Set([
  "patient",
  "visit",
  "visit_addendum",
  "diagnosis",
  "prescription",
  "medical_profile",
  "attachment",
]);

/** Append-only clinic audit primitive shared by every clinic-area mock namespace. */
export function writeClinicAudit(
  db: MockState,
  entry: {
    clinicId: string;
    actorName: string;
    action: string;
    entity: ClinicAuditEntry["entity"];
    before: Snapshot | null;
    after: Snapshot | null;
  },
): void {
  const subject = entry.after ?? entry.before;
  if (!subject) return;
  db.clinicAudit.unshift({
    id: newId(),
    clinicId: entry.clinicId,
    actorName: scrubAuditText(entry.actorName),
    action: entry.action,
    entity: entry.entity,
    category: PATIENT_ACCESS.has(entry.entity) ? "patient_access" : "administrative",
    entityId: subject.id,
    before: entry.before ? scrubbed(withNames(db, entry.clinicId, entry.before)) : null,
    after: entry.after ? scrubbed(withNames(db, entry.clinicId, entry.after)) : null,
    createdAt: new Date().toISOString(),
  });
}
