import type { ApiClient } from "../api-client";
import { createHttpBranches } from "./http-branches";
import type { HttpContext } from "./http-context";
import { createHttpInvitations } from "./http-invitations";
import { createHttpPatients } from "./http-patients";
import { createHttpPlatform } from "./http-platform";
import { createHttpRoles } from "./http-roles";
import { createHttpSession } from "./http-session";
import { createTransport } from "./http-transport";
import { createUnservedNamespaces } from "./http-unserved";
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
    ...createUnservedNamespaces(),
  };
}
