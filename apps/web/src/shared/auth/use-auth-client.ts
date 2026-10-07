import { useState } from "react";
import { createAuthClient, type AuthClient } from "@/shared/api/http/auth-client";

/** HTTP mode only: Better Auth on the same origin (the mock signs in with the persona picker). */
export function useAuthClient(): AuthClient {
  const [client] = useState(() => createAuthClient());
  return client;
}
