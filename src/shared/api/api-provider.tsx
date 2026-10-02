import { createContext, useContext, useState, type ReactNode } from "react";
import type { ApiClient } from "./api-client";
import { createMockApiClient } from "./mock/mock-adapter";

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  // Swap this line for an HTTP adapter later; no screen changes needed.
  const [client] = useState<ApiClient>(() => createMockApiClient());
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error("useApi must be used inside ApiProvider");
  return client;
}
