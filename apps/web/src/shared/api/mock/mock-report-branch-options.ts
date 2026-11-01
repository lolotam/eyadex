import type { ReportId } from "@eyadex/contracts/finance-reports";
import {
  branchOptionListResponseSchema,
  optionListQuerySchema,
} from "@eyadex/contracts/role-admin";
import type { Persona } from "@eyadex/contracts/session";
import { openReport } from "./mock-report-access";
import { fromCursor, toCursor } from "./mock-list-cursor";
import type { MockState } from "./mock-store";

/** The report's guard, route key, options query, covering keys and exact branch reach, in API order. */
export function reportBranchOptions(
  db: MockState,
  persona: Persona,
  report: ReportId,
  raw: unknown,
) {
  const { ctx, query } = openReport(db, persona, report, optionListQuerySchema, raw);
  const after = query.cursor === undefined ? null : fromCursor(query.cursor);
  const kept = db.branches
    .filter((branch) => branch.clinicId === ctx.clinicId && ctx.branchIds.includes(branch.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const rest = after === null ? kept : kept.filter((branch) => branch.id > after);
  const items = rest.slice(0, query.limit);
  const last = items.at(-1);
  return branchOptionListResponseSchema.parse({
    items: items.map(({ id, nameAr, nameEn, isActive }) => ({ id, nameAr, nameEn, isActive })),
    nextCursor: rest.length > query.limit && last !== undefined ? toCursor(last.id) : null,
    total: kept.length,
  });
}
