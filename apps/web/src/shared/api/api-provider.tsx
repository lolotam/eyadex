import { createContext, useContext, useState, type ReactNode } from "react";
import type { ApiClient } from "./api-client";
import { API_MODE } from "./api-mode";
import { createHttpApiClient } from "./http/http-adapter";
import { createMockApiClient } from "./mock/mock-adapter";

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ children }: { children: ReactNode }) {
  // Chosen at build time by VITE_API_MODE; screens only ever see the ApiClient interface.
  const [client] = useState<ApiClient>(() =>
    API_MODE === "http" ? createHttpApiClient() : createMockApiClient(),
  );
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error("useApi must be used inside ApiProvider");
  return client;
}
