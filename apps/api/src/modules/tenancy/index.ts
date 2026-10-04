// The only file other modules may import (CLAUDE.architecture.md §2.1).
export { TenancyModule } from "./tenancy.module.ts";
export { decideClinicAccess, type ClinicAccess, type ClinicStatus } from "./domain/clinic-access.ts";
export { checkLimit, type LimitCheck, type LimitUsage } from "./domain/limits.ts";
export { decideBranchDeactivation, type BranchDeactivation } from "./domain/branch-rules.ts";
export { isModuleEnabled, type ClinicModule } from "./domain/feature-flags.ts";
export { CLOCK, type Clock } from "./ports/clock.ts";
export { CLINIC_READER, type ClinicReader } from "./ports/clinic-reader.ts";
export { BRANCH_READER, type BranchReader, type BranchRecord } from "./ports/branch-reader.ts";
export { getClinicAccessState, type ClinicAccessState } from "./queries/clinic-access-state.ts";
export { listClinicBranches } from "./queries/clinic-branches.ts";
