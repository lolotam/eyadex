export { createDatabase, type Database } from "./database.ts";
export { TenantContextViolationError } from "./context-violation.ts";
export { ForbiddenStatementError } from "./statement-guard.ts";
export { DatabaseError } from "./database-error.ts";
export type { DatabaseOptions, DatabaseRole, IdGenerator } from "./options.ts";
export type { Tx } from "./tenant.ts";
export {
  createDispatcherOutbox,
  type ClaimedEvent,
  type DispatchOutcome,
  type DispatcherOptions,
  type DispatcherOutbox,
  type DispatcherRole,
} from "./dispatcher.ts";
// The tag alone, so a caller can write `tx.execute(sql\`…\`)` without its own drizzle-orm copy. It builds a
// query object; it opens nothing and reaches no client.
export { sql } from "drizzle-orm";
