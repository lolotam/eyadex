import type { ApiClient } from "../api-client";
import { createMockPlatform } from "./mock-platform";
import { createMockSession } from "./mock-session";
import { createMockBranches } from "./mock-branches";
import { createMockUsers } from "./mock-users";
import { createMockInvitations } from "./mock-invitations";

export function createMockApiClient(): ApiClient {
  return {
    session: createMockSession(),
    platform: createMockPlatform(),
    branches: createMockBranches(),
    users: createMockUsers(),
    invitations: createMockInvitations(),
  };
}
