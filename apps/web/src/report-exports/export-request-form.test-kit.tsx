// Shared setup for the export request form tests: real root mock client, real hooks and providers.
/* eslint-disable react-refresh/only-export-components -- a test kit, never hot-reloaded */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import type { ApiClient } from "@/shared/api/api-client";
import { createMockApiClient } from "@/shared/api/mock/mock-adapter";
import { fixture, id, NOW } from "@/shared/api/mock/mock-report-export.test-kit";
import { getState, personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { Harness } from "./export-form-harness.test-kit";

/** What the mocked providers hand to the real hooks; each test file mocks them onto this. */
export const context = {
  api: null as ApiClient | null,
  persona: null as Persona | null,
  session: null as SessionContext | null,
};
export const flush = (ms = 2000) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
/** Fake clock, clean language storage and restored spies around every test. */
export function useFormTestClock() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval"] });
    vi.setSystemTime(NOW);
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
}

export const TAKINGS = ["view:report_takings:branch", "view:payments:branch"];
export const ANALYTICS = ["view:report_analytics:clinic", "view:invoices:clinic"];
export const CREDIT = ["view:report_patients:clinic", "view:payments:clinic"];
export async function sessionOf(api: ApiClient, persona: Persona) {
  const pending = api.session.getContext(persona);
  await vi.advanceTimersByTimeAsync(200);
  return pending;
}
export async function setup(keys: string[], history = false, reach: number | null = null) {
  const f = fixture();
  f.db.branches.push({
    ...f.a,
    id: id(30000),
    nameAr: "فرع قديم",
    nameEn: "Old branch",
    isActive: false,
  });
  const api = createMockApiClient();
  const own = f.db.branches.filter((b) => b.clinicId === f.ctx.clinicId).map((b) => b.id);
  const persona = personaWith(keys, reach === null ? null : own.slice(0, reach));
  Object.assign(context, { api, persona, session: await sessionOf(api, persona) });
  const real = api.reports.requestExport.bind(api.reports);
  const post = vi.spyOn(api.reports, "requestExport");
  const view = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider>
        <Harness history={history} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  await flush();
  return { f, api, persona, post, real, view };
}
export const R = ar.reportExports.request;
export const E = en.reportExports.request;
export const pickIn = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
export const typeIn = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
export const submit = async (label = R.submit) => {
  fireEvent.click(screen.getByRole("button", { name: label }));
  await flush();
};
export const noRawKeys = () =>
  expect(document.body.textContent).not.toMatch(/reportExports\.|validation\.|errors\.|__all__/);
