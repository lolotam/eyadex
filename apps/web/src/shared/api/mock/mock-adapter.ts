import type { ApiClient } from "../api-client";
import { createMockPlatform } from "./mock-platform";
import { createMockPlatformInvites } from "./mock-platform-invites";
import { createMockSession } from "./mock-session";
import { createMockBranches } from "./mock-branches";
import { createMockUsers } from "./mock-users";
import { createMockInvitations } from "./mock-invitations";
import { createMockRoles } from "./mock-roles";
import { createMockPatients } from "./mock-patients";
import { createMockAppointments } from "./mock-appointments";
import { createMockSchedules } from "./mock-schedules";
import { createMockServices } from "./mock-services";
import { createMockAuditLog } from "./mock-audit-log";
import { createMockAccount, createMockClinicSettings } from "./mock-clinic-settings";
import {
  createMockPlatformOverview,
  createMockPlatformSettings,
  createMockPlatformTeam,
} from "./mock-platform-console";

export function createMockApiClient(): ApiClient {
  return {
    session: createMockSession(),
    platform: { ...createMockPlatform(), ...createMockPlatformInvites() },
    branches: createMockBranches(),
    users: createMockUsers(),
    invitations: createMockInvitations(),
    roles: createMockRoles(),
    patients: createMockPatients(),
    scheduling: { ...createMockServices(), ...createMockSchedules() },
    appointments: createMockAppointments(),
    audit: createMockAuditLog(),
    clinicSettings: createMockClinicSettings(),
    account: createMockAccount(),
    platformOverview: createMockPlatformOverview(),
    platformTeam: createMockPlatformTeam(),
    platformSettings: createMockPlatformSettings(),
  };
}
