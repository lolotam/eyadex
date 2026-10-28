import type { ClinicAuditEntry } from "@eyadex/contracts/organization";
import { reportExportAuditDetailsSchema } from "@eyadex/contracts/finance-reports";
import { scrubAuditText, scrubAuditValue } from "@eyadex/observability/audit-text";
import { newId, type MockState } from "./mock-store";

type Snapshot = { id: string } & Record<string, unknown>;
type Fields = Record<string, unknown>;
/** The row's subject: snapshots that carry its id, or the id given apart (a medical row, as the API). */
type Subject =
  | { before: Snapshot | null; after: Snapshot | null; entityId?: undefined }
  | { before: Fields | null; after: Fields | null; entityId: string | null };

// An id no longer found keeps the API's shape (ADR-0019): the id with null names.
const unnamed = (id: unknown) => (typeof id === "string" ? { id, nameAr: null, nameEn: null } : id);

/** Reference fields stored with the names they had at write time (history never changes). */
const ROLE_REFS = new Set(["roleId"]);
const BRANCH_REFS = new Set(["branchId", "branchIds", "registrationBranchId"]);

function withNames(db: MockState, clinicId: string, snap: Fields): Record<string, unknown> {
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
  "invoice",
  "invoice_link",
  "payment",
  "patient_credit",
  "refund",
]);

/** Append-only clinic audit primitive shared by every clinic-area mock namespace. */
export function writeClinicAudit(
  db: MockState,
  entry: {
    clinicId: string;
    actorName: string;
    action: string;
    entity: ClinicAuditEntry["entity"];
    /** An invoice snapshot is shape-checked by its writer and stored as is (as the API). */
    exact?: boolean;
  } & Subject,
  now: Date = new Date(),
): void {
  // Export metadata is validated before insertion, never expanded into branch names or scrubbed
  // as free text. Unknown reports cannot become administrative platform-visible activity.
  const exportDetails =
    entry.entity === "finance_report_export"
      ? reportExportAuditDetailsSchema.parse(entry.after)
      : null;
  if (
    exportDetails !== null &&
    (entry.action !== "finance_report.exported" || entry.before !== null)
  )
    throw new Error("invalid export audit event");
  const category =
    exportDetails !== null
      ? ["outstanding", "patient_credit", "refunds", "discounts"].includes(exportDetails.report)
        ? "patient_access"
        : "administrative"
      : PATIENT_ACCESS.has(entry.entity)
        ? "patient_access"
        : "administrative";
  const entityId =
    entry.entityId === undefined ? (entry.after ?? entry.before)?.id : entry.entityId;
  if (entityId === undefined) return;
  const side = (snap: Fields | null) =>
    snap === null
      ? null
      : entry.exact
        ? structuredClone(snap)
        : scrubbed(withNames(db, entry.clinicId, snap));
  db.clinicAudit.unshift({
    id: newId(),
    clinicId: entry.clinicId,
    actorName: scrubAuditText(entry.actorName),
    action: entry.action,
    entity: entry.entity,
    category,
    entityId,
    before: side(entry.before),
    after: exportDetails === null ? side(entry.after) : structuredClone(exportDetails),
    createdAt: now.toISOString(),
  });
}
