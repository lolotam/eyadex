import { z } from "zod";

export const idSchema = z.string().uuid();

export const languageSchema = z.enum(["ar", "en"]);
export type Language = z.infer<typeof languageSchema>;

export const pageQuerySchema = z.object({
  cursor: z.string().nullable(),
  limit: z.number().int().min(1).max(100),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  total: number;
};

export const apiErrorCodeSchema = z.enum([
  "not_found",
  "idempotency_conflict",
  "slug_taken",
  "reserved_slug",
  "limit_below_usage",
  "limit_reached",
  "last_active_branch",
  "forbidden",
  "module_disabled",
  "validation",
  "email_taken",
  "last_active_admin",
  "account_disabled",
  "subscription_blocked",
  "role_inactive",
  "branch_inactive",
  "invitation_expired",
  "invitation_cancelled",
  "invitation_used",
  "role_locked",
  "role_in_use",
  "role_name_taken",
  "unknown",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
