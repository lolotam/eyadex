import type { ApiClient } from "../api-client";
import { createMockPlatform } from "./mock-platform";
import { createMockSession } from "./mock-session";
import { createMockBranches } from "./mock-branches";

export function createMockApiClient(): ApiClient {
  return {
    session: createMockSession(),
    platform: createMockPlatform(),
    branches: createMockBranches(),
  };
}
