import type { ApiClient } from "../api-client";
import { createMockPlatform } from "./mock-platform";
import { createMockPlatformInvites } from "./mock-platform-invites";
import { createMockSession } from "./mock-session";
import { createMockBranches } from "./mock-branches";
import { createMockUsers } from "./mock-users";
import { createMockInvitations } from "./mock-invitations";
import { createMockRoles } from "./mock-roles";
import { createMockPatients } from "./mock-patients";
import { createMockAuditLog } from "./mock-audit-log";

export function createMockApiClient(): ApiClient {
  return {
    session: createMockSession(),
    platform: { ...createMockPlatform(), ...createMockPlatformInvites() },
    branches: createMockBranches(),
    users: createMockUsers(),
    invitations: createMockInvitations(),
    roles: createMockRoles(),
    patients: createMockPatients(),
    audit: createMockAuditLog(),
  };
}
