// Shared setup for the export request form tests: real root mock client, real hooks and providers.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import type { ApiClient } from "@/shared/api/api-client";
import { createMockApiClient } from "@/shared/api/mock/mock-adapter";
import { fixture, id, NOW } from "@/shared/api/mock/mock-report-export.test-kit";
import { getState, personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { I18nProvider, useI18n } from "@/shared/i18n/i18n-provider";
import { ExportHistory } from "./export-history";
import { ExportRequestForm } from "./export-request-form";

/** What the mocked providers hand to the real hooks; each test file mocks them onto this. */
export const context = {
  api: null as ApiClient | null,
  persona: null as Persona | null,
  session: null as SessionContext | null,
};
// A native select stands in for the Radix picker, which jsdom cannot open; ids and aria pass through.
export const NativeSelect = (p: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  error?: ReactNode;
}) => (
  <div>
    <label htmlFor={p.id}>{p.label}</label>
    <select
      id={p.id}
      value={p.value}
      disabled={p.disabled}
      aria-invalid={p.error ? true : undefined}
      aria-describedby={p.error ? `${p.id}-error` : undefined}
      onChange={(e) => p.onChange(e.target.value)}
    >
      <option value="">{p.placeholder ?? ""}</option>
      {p.options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
    {p.error ? <p id={`${p.id}-error`}>{p.error}</p> : null}
  </div>
);

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
export let setLang: (l: "ar" | "en") => void = () => undefined;
export let bump: () => void = () => undefined;
/** Renders fresh form elements on `bump`, so a changed session reaches the real hooks. */
export function Harness({ history }: { history: boolean }) {
  setLang = useI18n().setLang;
  const [, setTick] = useState(0);
  bump = () => setTick((n) => n + 1);
  return (
    <>
      <ExportRequestForm />
      {history ? <ExportHistory /> : null}
    </>
  );
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
