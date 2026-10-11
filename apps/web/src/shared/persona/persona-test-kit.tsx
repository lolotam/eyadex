/** Screen-test render: the mock API, a session (optionally other keys), Arabic, no router. */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { ApiProvider } from "@/shared/api/api-provider";
import { api } from "@/shared/api/mock/mock-test-kit";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PersonaContext } from "@/shared/persona/persona-context";

export async function renderAs(persona: Persona, node: ReactNode, permissions?: string[]) {
  const real = await api.session.getContext(persona);
  const session = permissions ? { ...real, permissions } : real;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const http = { session, isLoading: false, error: null, area: "clinic" as const, retry: vi.fn() };
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ApiProvider>
          <PersonaContext.Provider value={{ persona, ready: true, setPersona: vi.fn(), http }}>
            {node}
          </PersonaContext.Provider>
        </ApiProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}
