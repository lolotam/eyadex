import { sql, type SQL } from "drizzle-orm";

import type { MemberBranches } from "../domain/billing-actor.ts";

/**
 * The caller's branch reach as a condition on a branch column: every branch, the member's branches, or
 * none (a member of no branch sees nothing).
 *
 * @param reach the caller's reach
 * @param column the branch column of the list's main alias
 * @returns the condition
 */
export function branchCondition(reach: MemberBranches, column: SQL): SQL {
  if (reach.all) return sql`true`;
  if (reach.branchIds.length === 0) return sql`false`;
  return sql`${column} IN (${sql.join(
    reach.branchIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}
