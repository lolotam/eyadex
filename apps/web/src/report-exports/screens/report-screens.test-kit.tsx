// Shared setup for the report screen tests: the real root mock client, real hooks and providers.
/* eslint-disable react-refresh/only-export-components -- a test kit, never hot-reloaded */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import type { ApiClient } from "@/shared/api/api-client";
import { createMockApiClient } from "@/shared/api/mock/mock-adapter";
import { ar } from "@/shared/i18n/ar";
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

const fromInput = () =>
  (screen.getByLabelText(ar.financeReports.filters.from) as HTMLInputElement).value;

/**
 * A new From date for a filter-change test on a screen whose default range is the current clinic
 * month: the first day of the month before it. It always differs from the default and always stays
 * before To and inside the range cap, whatever day the suite runs on, even on the first of a month
 * (a fixed calendar date would break on some day; so would "day 2").
 */
export const previousMonthStart = () => {
  const [y, m] = fromInput().split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 2, 1)).toISOString().slice(0, 10);
};

/**
 * Same purpose for a screen whose default range is the last N days (R5): the day after the default
 * From. It differs from the default, never passes To (the default To is today) and never widens the
 * range, so the cap holds on any day.
 */
export const dayAfterDefaultFrom = () => {
  const [y, m, d] = fromInput().split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
};

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
