import type { ApiClient } from "../api-client";
import { createMockPlatform } from "./mock-platform";
import { createMockSession } from "./mock-session";

export function createMockApiClient(): ApiClient {
  return {
    session: createMockSession(),
    platform: createMockPlatform(),
  };
}
