import type { ClinicAuditEntry } from "@contracts/organization";
import { newId, type MockState } from "./mock-store";

type Snapshot = { id: string } & Record<string, unknown>;

/** Reference fields stored with the names they had at write time (history never changes). */
const ROLE_REFS = new Set(["roleId"]);
const BRANCH_REFS = new Set(["branchId", "branchIds", "registrationBranchId"]);

function withNames(db: MockState, clinicId: string, snap: Snapshot): Record<string, unknown> {
  const role = (id: unknown) => {
    const r = db.roles.find((x) => x.clinicId === clinicId && x.id === id);
    return r ? { id: r.id, nameAr: r.nameAr, nameEn: r.nameEn } : id;
  };
  const branch = (id: unknown) => {
    const b = db.branches.find((x) => x.clinicId === clinicId && x.id === id);
    return b ? { id: b.id, nameAr: b.nameAr, nameEn: b.nameEn } : id;
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(structuredClone(snap))) {
    const map = ROLE_REFS.has(key) ? role : BRANCH_REFS.has(key) ? branch : null;
    out[key] = map ? (Array.isArray(value) ? value.map(map) : map(value)) : value;
  }
  return out;
}

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
    actorName: entry.actorName,
    action: entry.action,
    entity: entry.entity,
    category: entry.entity === "patient" ? "patient_access" : "administrative",
    entityId: subject.id,
    before: entry.before ? withNames(db, entry.clinicId, entry.before) : null,
    after: entry.after ? withNames(db, entry.clinicId, entry.after) : null,
    createdAt: new Date().toISOString(),
  });
}
