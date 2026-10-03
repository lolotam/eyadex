import type { ClinicAuditEntry } from "@contracts/organization";
import { newId, type MockState } from "./mock-store";

type Snapshot = { id: string } & Record<string, unknown>;

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
    before: entry.before ? structuredClone(entry.before) : null,
    after: entry.after ? structuredClone(entry.after) : null,
    createdAt: new Date().toISOString(),
  });
}
