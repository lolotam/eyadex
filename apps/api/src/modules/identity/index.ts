// The only file other modules may import (CLAUDE.architecture.md §2.1).
export { IdentityModule } from "./identity.module.ts";
export { PgSeatUsageReader } from "./persistence/pg-seat-usage-reader.ts";
export { AuthModule } from "./auth/auth.module.ts";
export { AREA_AUTH, type AreaAuth, type ResolvedSession } from "./auth/area-auth.ts";
export { registerAuthRoutes } from "./auth/auth-handler.ts";
export { SessionGuard, type AuthenticatedRequest } from "./auth/session.guard.ts";
export { AUTH_RATE_LIMIT, type AuthRateLimit } from "./auth/rate-limit.module.ts";
export { InvitationsModule } from "./invitations.module.ts";
export { PUBLIC_V1_ROUTES } from "./auth/public-rate-limits.ts";
export { PlatformAreaGuard } from "./auth/platform-area.guard.ts";
export { hashInvitationToken } from "./persistence/pg-first-admin-provisioner.ts";
export { AccessGuard, type ClinicRequest } from "./access/access.guard.ts";
export {
  Authenticated,
  PlatformStaff,
  Public,
  Require,
  RequiresFeature,
} from "./access/access-rules.ts";
export { assertRouteAccess, registeredRoutes } from "./access/route-access-check.ts";
export type { ClinicRequestContext, BranchScope } from "./access/clinic-context.ts";
export { ClinicAccessModule } from "./clinic-access.module.ts";
export { RolesModule } from "./roles.module.ts";
export {
  AUTHORIZATION_INVALIDATOR,
  type AuthorizationInvalidator,
} from "./ports/authorization-invalidator.ts";
export {
  MEMBER_SESSION_REVOKER,
  type MemberSessionRevoker,
} from "./ports/member-session-revoker.ts";
export { AuthorizationCacheModule } from "./access/authorization-cache.module.ts";
export { PgExclusiveMembers } from "./persistence/pg-exclusive-members.ts";
export { PlatformTeamModule, PLATFORM_TEAM_CHANGES } from "./platform-team.module.ts";
export {
  PlatformTeamChanges,
  PLATFORM_TEAM_INVITED_EVENT,
  type StatusChange,
} from "./use-cases/platform-team/platform-team-changes.ts";
export {
  PLATFORM_SESSION_REVOKER,
  type PlatformSessionRevoker,
} from "./ports/platform-session-revoker.ts";
export {
  readFirstPlatformAccountInput,
  type FirstPlatformAccountInput,
} from "./auth/first-platform-account-input.ts";
export { PgMemberNames } from "./persistence/pg-member-names.ts";
export { PgRoleNames } from "./persistence/pg-role-names.ts";
export { PgProviderDirectory, type ProviderRow } from "./persistence/pg-provider-directory.ts";
