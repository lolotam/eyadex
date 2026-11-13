import { useState, type ReactNode } from "react";
import type { ApiClient } from "./api-client";
import { ApiContext } from "./api-context";
import { API_MODE } from "./api-mode";
import { createHttpApiClient } from "./http/http-adapter";
import { createMockApiClient } from "./mock/mock-adapter";

export { useApi } from "./api-context";

export function ApiProvider({ children }: { children: ReactNode }) {
  // Chosen at build time by VITE_API_MODE; screens only ever see the ApiClient interface.
  const [client] = useState<ApiClient>(() =>
    API_MODE === "http" ? createHttpApiClient() : createMockApiClient(),
  );
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}
