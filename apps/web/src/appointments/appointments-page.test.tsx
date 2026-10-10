import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiProvider } from "@/shared/api/api-provider";
import { api, as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PersonaContext } from "@/shared/persona/persona-context";
import { AppointmentsPage } from "./appointments-page";

// The Forbidden page links home; no router is mounted here.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/clinic">{children}</a>,
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
}));

beforeEach(() => resetMockData());
afterEach(() => cleanup());

async function renderWith(permissions: string[]) {
  const persona = as("clinic_admin");
  const session = { ...(await api.session.getContext(persona)), permissions };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const http = { session, isLoading: false, error: null, area: "clinic" as const, retry: vi.fn() };
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ApiProvider>
          <PersonaContext.Provider value={{ persona, ready: true, setPersona: vi.fn(), http }}>
            <AppointmentsPage />
          </PersonaContext.Provider>
        </ApiProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

// A3 inverts Codex PR #64: the own key's reads answer with the caller's own column, so it opens too.
describe("the appointments page", () => {
  it("is Forbidden to a role holding no appointments view key", async () => {
    await renderWith(["view:patients:own"]);
    expect(screen.getByText(ar.forbidden.title)).toBeInTheDocument();
  });

  it.each(["view:appointments:own", "view:appointments:branch", "view:appointments:clinic"])(
    "opens for %s",
    async (key) => {
      await renderWith([key]);
      expect(screen.queryByText(ar.forbidden.title)).toBeNull();
    },
  );
});
