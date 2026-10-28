import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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

const context = vi.hoisted(() => ({
  api: null as ApiClient | null,
  persona: null as Persona | null,
  session: null as SessionContext | null,
}));
vi.mock("@/shared/api/api-provider", () => ({ useApi: () => context.api }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: context.persona, ready: true }),
  useSession: () => ({ session: context.session, isLoading: false, error: null }),
}));
// A native select stands in for the Radix picker, which jsdom cannot open; ids and aria pass through.
vi.mock("./export-select-field", () => ({
  ExportSelectField: (p: {
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
  ),
}));

const flush = (ms = 2000) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
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

const TAKINGS = ["view:report_takings:branch", "view:payments:branch"];
const ANALYTICS = ["view:report_analytics:clinic", "view:invoices:clinic"];
const CREDIT = ["view:report_patients:clinic", "view:payments:clinic"];
async function sessionOf(api: ApiClient, persona: Persona) {
  const pending = api.session.getContext(persona);
  await vi.advanceTimersByTimeAsync(200);
  return pending;
}
let setLang: (l: "ar" | "en") => void = () => undefined;
let bump: () => void = () => undefined;
/** Renders fresh form elements on `bump`, so a changed session reaches the real hooks. */
function Harness({ history }: { history: boolean }) {
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
async function setup(keys: string[], history = false, reach: number | null = null) {
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
const R = ar.reportExports.request;
const E = en.reportExports.request;
const pickIn = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = async (label = R.submit) => {
  fireEvent.click(screen.getByRole("button", { name: label }));
  await flush();
};
const noRawKeys = () =>
  expect(document.body.textContent).not.toMatch(/reportExports\.|validation\.|errors\.|__all__/);

it("labels every field in Arabic and English with only the reports the actor may export", async () => {
  await setup([...TAKINGS, "view:report_analytics:clinic", "view:invoices:branch"]);
  const options = () =>
    [...(screen.getByLabelText(R.report) as HTMLSelectElement).options].map((o) => o.text);
  expect(options()).toEqual([
    R.reportPlaceholder,
    ar.reportExports.reports.daily_takings,
    ar.reportExports.reports.period_summary,
  ]);
  for (const label of [R.report, R.from, R.to, R.branch, R.format, R.language])
    expect(screen.getByLabelText(label)).toBeTruthy();
  expect(screen.queryByLabelText(R.groupBy)).toBeNull();
  pickIn(R.report, "daily_takings");
  await flush();
  expect((screen.getByLabelText(R.groupBy) as HTMLSelectElement).value).toBe("day");
  pickIn(R.report, "period_summary");
  expect((screen.getByLabelText(R.groupBy) as HTMLSelectElement).value).toBe("month");
  expect((screen.getByLabelText(R.language) as HTMLSelectElement).value).toBe("ar");
  act(() => setLang("en"));
  for (const label of [E.report, E.from, E.to, E.branch, E.format, E.language, E.groupBy])
    expect(screen.getByLabelText(label)).toBeTruthy();
  expect((screen.getByLabelText(E.language) as HTMLSelectElement).value).toBe("en");
  pickIn(E.language, "ar");
  act(() => setLang("ar"));
  act(() => setLang("en"));
  expect((screen.getByLabelText(E.language) as HTMLSelectElement).value).toBe("ar");
  noRawKeys();
});

it("lists real bilingual branch names, the inactive one marked, and all branches explicitly", async () => {
  await setup(ANALYTICS);
  pickIn(R.report, "by_service");
  await flush();
  const texts = (label: string) =>
    [...(screen.getByLabelText(label) as HTMLSelectElement).options].map((o) => o.text);
  expect(texts(R.branch)).toContain(R.allBranches);
  expect(texts(R.branch)).toContain("فرع أ");
  expect(texts(R.branch)).toContain(R.inactive.replace("{name}", "فرع قديم"));
  act(() => setLang("en"));
  expect(texts(E.branch)).toContain(E.inactive.replace("{name}", "Old branch"));
  expect(texts(E.branch)).toContain("Branch A");
  expect((screen.getByLabelText(E.branch) as HTMLSelectElement).value).toBe("__all__");
  noRawKeys();
});

it.each(["csv", "xlsx"] as const)(
  "queues the exact %s body and the row appears in own history",
  async (format) => {
    const { post, persona } = await setup(ANALYTICS, true);
    pickIn(R.report, "by_service");
    type(R.from, "2026-01-01");
    type(R.to, "2026-03-31");
    await flush();
    pickIn(R.branch, id(30000));
    pickIn(R.format, format);
    pickIn(R.language, "en");
    await submit();
    expect(post.mock.calls).toEqual([
      [
        persona,
        {
          report: "by_service",
          from: "2026-01-01",
          to: "2026-03-31",
          branchId: id(30000),
          format,
          language: "en",
        },
      ],
    ]);
    expect(screen.getByText(R.queued)).toBeTruthy();
    expect(screen.queryByText(ar.reportExports.empty)).toBeNull();
    expect(screen.getAllByText(ar.reportExports.reports.by_service).length).toBeGreaterThan(1);
    expect((screen.getByLabelText(R.from) as HTMLInputElement).value).toBe("2026-01-01");
    noRawKeys();
  },
);

it("R6 shows the clinic-wide balance note in both languages and still requires its dates", async () => {
  const { post } = await setup(CREDIT);
  expect(screen.queryByText(R.creditNote)).toBeNull();
  pickIn(R.report, "patient_credit");
  await flush();
  expect(screen.getByRole("note").textContent).toBe(R.creditNote);
  await submit();
  expect(post).not.toHaveBeenCalled();
  expect(screen.getByLabelText(R.from).getAttribute("aria-invalid")).toBe("true");
  expect(screen.getAllByText(R.issues.date).length).toBe(2);
  act(() => setLang("en"));
  expect(screen.getByRole("note").textContent).toBe(E.creditNote);
  type(E.from, "2026-02-01");
  type(E.to, "2026-01-01");
  await submit(E.submit);
  expect(screen.getByText(E.issues.dateOrder)).toBeTruthy();
  type(E.from, "2026-01-01");
  type(E.to, "2026-01-31");
  await submit(E.submit);
  expect(post.mock.calls[0]![1]).toMatchObject({
    report: "patient_credit",
    from: "2026-01-01",
    to: "2026-01-31",
  });
  noRawKeys();
});

it("no report, failed branches or a reach-invalid branch never POST; retry recovers", async () => {
  const { post, api, persona } = await setup(TAKINGS, false, 2);
  await submit();
  expect(screen.getByText(R.fields.reportRequired)).toBeTruthy();
  const real = api.reports.branchOptions.bind(api.reports);
  let fail = true;
  vi.spyOn(api.reports, "branchOptions").mockImplementation(async (...a) => {
    if (fail) throw new TypeError("network");
    return real(...a);
  });
  pickIn(R.report, "daily_takings");
  type(R.from, "2026-01-01");
  type(R.to, "2026-01-31");
  await flush();
  expect(screen.getByText(R.branchesError)).toBeTruthy();
  fireEvent.submit(screen.getByRole("button", { name: R.submit }).closest("form")!);
  await flush();
  expect(screen.getByText(R.fields.branchNotReady)).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: ar.reportExports.retry }));
  await flush();
  const b = getState().branches.filter((x) => x.clinicId === persona.clinicId)[1]!;
  pickIn(R.branch, b.id);
  getState().members.find((m) => m.id === persona.memberId)!.branchIds = [
    getState().branches.filter((x) => x.clinicId === persona.clinicId)[0]!.id,
  ];
  context.session = await sessionOf(api, persona);
  act(() => bump());
  await flush();
  expect((screen.getByLabelText(R.branch) as HTMLSelectElement).value).toBe("__unavailable__");
  expect(screen.getAllByText(R.fields.branchUnavailable).length).toBeGreaterThan(0);
  await submit();
  expect(post).not.toHaveBeenCalled();
  pickIn(R.branch, "__all__");
  await submit();
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0]![1]).not.toHaveProperty("branchId");
});

it("a double click sends one POST and disables every control while pending", async () => {
  const { post, real } = await setup(TAKINGS);
  let release = () => undefined as void;
  post.mockImplementation(async (...a) => {
    await new Promise<void>((r) => (release = r));
    return real(...a);
  });
  pickIn(R.report, "daily_takings");
  type(R.from, "2026-01-01");
  type(R.to, "2026-01-31");
  await flush();
  const button = screen.getByRole("button", { name: R.submit });
  fireEvent.click(button);
  fireEvent.click(button);
  await act(async () => void (await Promise.resolve()));
  expect(post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: R.submitting })).toHaveProperty("disabled", true);
  expect(screen.getByLabelText(R.report)).toHaveProperty("disabled", true);
  expect(screen.queryByText(R.queued)).toBeNull();
  release();
  await flush();
  expect(screen.getByText(R.queued)).toBeTruthy();
});

it("losing the report key marks the form unavailable while own history stays", async () => {
  const { api, persona, post } = await setup(TAKINGS, true);
  pickIn(R.report, "daily_takings");
  type(R.from, "2026-01-01");
  type(R.to, "2026-01-31");
  await flush();
  await submit();
  const role = getState().roles.find(
    (r) => r.id === getState().members.find((m) => m.id === persona.memberId)!.roleId,
  )!;
  role.permissions = ["view:report_takings:branch"];
  context.session = await sessionOf(api, persona);
  act(() => bump());
  await flush();
  expect(screen.getAllByText(R.fields.reportUnavailable).length).toBeGreaterThan(0);
  expect((screen.getByLabelText(R.report) as HTMLSelectElement).value).toBe("daily_takings");
  await submit();
  expect(post).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText(ar.reportExports.reports.daily_takings).length).toBeGreaterThan(1);
  expect(screen.queryByText(ar.reportExports.empty)).toBeNull();
  noRawKeys();
});
