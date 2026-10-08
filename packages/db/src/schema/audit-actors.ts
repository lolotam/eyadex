import { pgView, text, uuid } from "drizzle-orm/pg-core";

/** The platform's window on who acted: platform account and clinic member names, nothing else (0034). */
export const platformAuditActors = pgView("platform_audit_actors", {
  userId: uuid("user_id").notNull(),
  fullName: text("full_name").notNull(),
}).existing();
