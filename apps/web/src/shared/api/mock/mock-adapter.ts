import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import type { SchedulingApi } from "../scheduling-client";
import { createMockPlatform } from "./mock-platform";
import { createMockPlatformInvites } from "./mock-platform-invites";
import { createMockSession } from "./mock-session";
import { createMockBranches } from "./mock-branches";
import { createMockUsers } from "./mock-users";
import { createMockInvitations } from "./mock-invitations";
import { createMockRoles } from "./mock-roles";
import { createMockPatients } from "./mock-patients";
import { createMockAuditLog } from "./mock-audit-log";
import { createMockAccount, createMockClinicSettings } from "./mock-clinic-settings";
import {
  createMockPlatformOverview,
  createMockPlatformSettings,
  createMockPlatformTeam,
} from "./mock-platform-console";

const notYet = () => Promise.reject(new ApiError("not_implemented"));
const pendingScheduling = Object.fromEntries(
  [
    "listServices",
    "createService",
    "updateService",
    "deactivateService",
    "reactivateService",
    "getBookingProfile",
    "setBookingProfile",
    "listProviders",
    "getProviderSchedule",
    "replaceBranchSchedule",
    "addTimeOff",
    "cancelTimeOff",
  ].map((name) => [name, notYet]),
) as unknown as SchedulingApi;

export function createMockApiClient(): ApiClient {
  return {
    session: createMockSession(),
    platform: { ...createMockPlatform(), ...createMockPlatformInvites() },
    branches: createMockBranches(),
    users: createMockUsers(),
    invitations: createMockInvitations(),
    roles: createMockRoles(),
    patients: createMockPatients(),
    scheduling: pendingScheduling,
    audit: createMockAuditLog(),
    clinicSettings: createMockClinicSettings(),
    account: createMockAccount(),
    platformOverview: createMockPlatformOverview(),
    platformTeam: createMockPlatformTeam(),
    platformSettings: createMockPlatformSettings(),
  };
}
