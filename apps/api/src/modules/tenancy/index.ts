// The only file other modules may import (CLAUDE.architecture.md §2.1).
export { TenancyModule } from "./tenancy.module.ts";
export {
  decideClinicAccess,
  type ClinicAccess,
  type ClinicStatus,
} from "./domain/clinic-access.ts";
export { checkLimit, type LimitCheck, type LimitUsage } from "./domain/limits.ts";
export { decideBranchDeactivation, type BranchDeactivation } from "./domain/branch-rules.ts";
export { isModuleEnabled, type ClinicModule } from "./domain/feature-flags.ts";
export { CLOCK, type Clock } from "./ports/clock.ts";
export { CLINIC_READER, type ClinicReader } from "./ports/clinic-reader.ts";
export {
  SEAT_USAGE_READER,
  type SeatUsage,
  type SeatUsageReader,
} from "./ports/seat-usage-reader.ts";
export { BRANCH_READER, type BranchReader, type BranchRecord } from "./ports/branch-reader.ts";
export { getClinicAccessState, type ClinicAccessState } from "./queries/clinic-access-state.ts";
export { listClinicBranches } from "./queries/clinic-branches.ts";
export {
  FIRST_ADMIN_PROVISIONER,
  type FirstAdminProvisioner,
  type FirstAdminRequest,
  type FirstAdminResult,
} from "./ports/first-admin-provisioner.ts";
export {
  ADMIN_INVITED_EVENT,
  CreateClinicWithAdmin,
  type CreateClinicCommand,
  type CreateClinicDeps,
} from "./use-cases/create-clinic-with-admin/create-clinic-with-admin.ts";
export {
  limitReachedDetails,
  type LimitReachedDetails,
  type LimitResource,
} from "./domain/limits.ts";
export { resolveExpiry, type ExpiryInput } from "./domain/subscription.ts";
export { CLINIC_LIMITS, type ClinicLimits } from "./ports/clinic-limits.ts";
export { ReaderClinicLimits } from "./queries/clinic-limits.ts";
export { getPlatformClinicDetail } from "./queries/platform-clinic-detail.ts";
export { PgClinicReader } from "./persistence/pg-clinic-reader.ts";
export {
  PlatformClinicChanges,
  type PlatformClinicChangesDeps,
} from "./use-cases/platform-clinic-changes/platform-clinic-changes.ts";
export {
  BranchChanges,
  type BranchActor,
  type BranchChange,
  type BranchChangesDeps,
} from "./use-cases/branch-changes/branch-changes.ts";
export { listBranches } from "./queries/list-branches.ts";
export {
  type ExclusiveMember,
  type ExclusiveMemberReader,
} from "./ports/exclusive-member-reader.ts";
export { usersUsage } from "./domain/limits.ts";
