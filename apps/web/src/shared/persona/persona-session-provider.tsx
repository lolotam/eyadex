import type { ReactNode } from "react";
import { API_MODE } from "@/shared/api/api-mode";
import { HttpPersonaProvider } from "./http-persona-provider";
import { MockPersonaProvider } from "./mock-persona-provider";

export function PersonaProvider({ children }: { children: ReactNode }) {
  return API_MODE === "http" ? (
    <HttpPersonaProvider>{children}</HttpPersonaProvider>
  ) : (
    <MockPersonaProvider>{children}</MockPersonaProvider>
  );
}
