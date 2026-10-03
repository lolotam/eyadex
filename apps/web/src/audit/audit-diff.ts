/** One readable row of an audit change: a field with its value before and after. */
export type AuditDiffRow = {
  field: string;
  before: unknown;
  after: unknown;
  changed: boolean;
};

/** Internal identifiers and bookkeeping timestamps never shown as audit fields. */
export const HIDDEN_AUDIT_FIELDS = new Set([
  "id",
  "clinicId",
  "userId",
  "memberId",
  "invitationId",
  "createdAt",
  "updatedAt",
  "lastLoginAt",
  "respondedAt",
  "tokenHash",
]);

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Field-by-field comparison of two snapshots; changed fields first, the record id left out. */
export function auditDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditDiffRow[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const rows: AuditDiffRow[] = [];
  for (const field of keys) {
    if (HIDDEN_AUDIT_FIELDS.has(field)) continue;
    const b = before ? before[field] : undefined;
    const a = after ? after[field] : undefined;
    rows.push({ field, before: b, after: a, changed: !same(b, a) });
  }
  return rows.sort((x, y) => Number(y.changed) - Number(x.changed));
}
