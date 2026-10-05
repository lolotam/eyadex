// The only file other modules may import (CLAUDE.architecture.md §2.1).
export { IdentityModule } from "./identity.module.ts";
export { PgSeatUsageReader } from "./persistence/pg-seat-usage-reader.ts";
export { AuthModule } from "./auth/auth.module.ts";
export { AREA_AUTH, type AreaAuth, type ResolvedSession } from "./auth/area-auth.ts";
export { registerAuthRoutes } from "./auth/auth-handler.ts";
export { SessionGuard, type AuthenticatedRequest } from "./auth/session.guard.ts";
export { AUTH_RATE_LIMIT, type AuthRateLimit } from "./auth/rate-limit.module.ts";
export { PlatformAreaGuard } from "./auth/platform-area.guard.ts";
export { hashInvitationToken } from "./persistence/pg-first-admin-provisioner.ts";
