import type { ApiClient } from "../api-client";
import { createHttpAudit } from "./http-audit";
import { createHttpBranches } from "./http-branches";
import type { HttpContext } from "./http-context";
import { createHttpInvitations } from "./http-invitations";
import { createHttpMedical } from "./http-medical";
import { createHttpPatients } from "./http-patients";
import { createHttpPlatform } from "./http-platform";
import {
  createHttpPlatformOverview,
  createHttpPlatformSettings,
  createHttpPlatformTeam,
} from "./http-platform-console";
import { createHttpRoles } from "./http-roles";
import { createHttpAppointments } from "./http-appointments";
import { createHttpScheduling } from "./http-scheduling";
import { createHttpSession } from "./http-session";
import { createHttpAccount, createHttpClinicSettings } from "./http-settings";
import { createTransport } from "./http-transport";
import { createHttpUsers } from "./http-users";

/**
 * The ApiClient over `fetch` to the API on the same origin (ADR-0004). The persona arguments are
 * ignored: the session cookie identifies the caller.
 */
export function createHttpApiClient(
  fetchImpl?: typeof fetch,
  now: () => Date = () => new Date(),
): ApiClient {
  const ctx: HttpContext = { transport: createTransport(fetchImpl), clinicId: null, now };
  return {
    session: createHttpSession(ctx),
    platform: createHttpPlatform(ctx),
    branches: createHttpBranches(ctx),
    users: createHttpUsers(ctx),
    invitations: createHttpInvitations(ctx),
    roles: createHttpRoles(ctx),
    patients: createHttpPatients(ctx),
    scheduling: createHttpScheduling(ctx),
    appointments: createHttpAppointments(ctx),
    medical: createHttpMedical(ctx),
    audit: createHttpAudit(ctx),
    clinicSettings: createHttpClinicSettings(ctx),
    account: createHttpAccount(ctx),
    platformOverview: createHttpPlatformOverview(ctx),
    platformTeam: createHttpPlatformTeam(ctx),
    platformSettings: createHttpPlatformSettings(ctx),
  };
}
