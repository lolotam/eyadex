// Shared setup for the report screen tests: the real root mock client, real hooks and providers.
/* eslint-disable react-refresh/only-export-components -- a test kit, never hot-reloaded */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import type { ApiClient } from "@/shared/api/api-client";
import { createMockApiClient } from "@/shared/api/mock/mock-adapter";
import { I18nProvider } from "@/shared/i18n/i18n-provider";

/** What the mocked providers hand to the real hooks; each test file mocks them onto this. */
export const context = {
  api: null as ApiClient | null,
  persona: null as Persona | null,
  session: null as SessionContext | null,
  reportId: "daily_takings",
};

export async function signIn(persona: Persona) {
  const api = createMockApiClient();
  Object.assign(context, { api, persona, session: await api.session.getContext(persona) });
  return api;
}

export function renderScreen(node: ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider>{node}</I18nProvider>
    </QueryClientProvider>,
  );
}

/** A router-free `Link`: these tests check the screen, not navigation. */
export function TestLink({
  children,
  to,
  params,
  className,
}: {
  children: ReactNode;
  to: string;
  params?: Record<string, string>;
  className?: string;
}) {
  const href = Object.entries(params ?? {}).reduce((p, [k, v]) => p.replace(`$${k}`, v), to);
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
