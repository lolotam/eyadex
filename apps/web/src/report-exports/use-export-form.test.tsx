import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import type { ApiClient } from "@/shared/api/api-client";
import { createMockApiClient } from "@/shared/api/mock/mock-adapter";
import { fixture, id, NOW } from "@/shared/api/mock/mock-report-export.test-kit";
import { getState, personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { exportJobsOf } from "@/shared/api/mock/mock-report-export-state";
import { I18nProvider, useI18n } from "@/shared/i18n/i18n-provider";
import { useExportForm } from "./use-export-form";

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

let client: QueryClient;
function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
  return renderHook(() => ({ form: useExportForm(), i18n: useI18n() }), { wrapper });
}
const flush = (ms = 2000) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  client?.clear();
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
async function setup(keys: string[], branchIds: string[] | null = null, extra = 0) {
  const f = fixture();
  for (let i = 0; i < extra; i++)
    f.db.branches.push({ ...f.a, id: id(20000 + i), nameEn: `B${i}`, isActive: i !== 7 });
  const api = createMockApiClient();
  const persona = personaWith(keys, branchIds);
  context.api = api;
  context.persona = persona;
  context.session = await sessionOf(api, persona);
  const realOptions = api.reports.branchOptions.bind(api.reports);
  const options = vi.spyOn(api.reports, "branchOptions");
  const post = vi.spyOn(api.reports, "requestExport");
  return { f, api, persona, post, options, realOptions };
}
const roleOf = (p: Persona) =>
  getState().roles.find(
    (r) => r.id === getState().members.find((m) => m.id === p.memberId)!.roleId,
  )!;
type H = ReturnType<typeof mount>;
async function fill(h: H, report: Parameters<H["result"]["current"]["form"]["setReport"]>[0]) {
  act(() => {
    h.result.current.form.setReport(report);
    h.result.current.form.setFrom("2026-01-01");
    h.result.current.form.setTo("2026-12-31");
  });
  await flush();
}

it("lists only reports with the report key and its covering key; a wider uncovered key adds none", async () => {
  await setup([...TAKINGS, "view:report_analytics:clinic", "view:invoices:branch", "view:users:clinic"]);
  const h = mount();
  expect(h.result.current.form.eligibleReports).toEqual(["daily_takings", "period_summary"]);
  act(() => h.result.current.form.setReport("by_service"));
  expect(h.result.current.form.reportEligible).toBe(false);
  expect(h.result.current.form.canSubmit).toBe(false);
});

it("starts empty with CSV; header language follows the UI until picked, then stays", async () => {
  await setup(TAKINGS);
  const h = mount();
  expect(h.result.current.form.draft).toEqual({
    report: null,
    from: "",
    to: "",
    branchId: null,
    groupBy: null,
    format: "csv",
    language: "ar",
  });
  act(() => h.result.current.i18n.setLang("en"));
  expect(h.result.current.form.draft.language).toBe("en");
  act(() => h.result.current.form.setLanguage("ar"));
  act(() => h.result.current.i18n.setLang("en"));
  act(() => h.result.current.i18n.setLang("ar"));
  act(() => h.result.current.i18n.setLang("en"));
  expect(h.result.current.form.draft.language).toBe("ar");
});

it("groups R1 by day and R2 by month, editable; other reports omit grouping entirely", async () => {
  const { post } = await setup([...TAKINGS, ...ANALYTICS]);
  const h = mount();
  act(() => h.result.current.form.setReport("daily_takings"));
  expect(h.result.current.form.draft.groupBy).toBe("day");
  expect(h.result.current.form.groupByOptions).toEqual(["day", "month"]);
  act(() => h.result.current.form.setReport("period_summary"));
  expect(h.result.current.form.draft.groupBy).toBe("month");
  act(() => h.result.current.form.setGroupBy("day"));
  expect(h.result.current.form.draft.groupBy).toBe("day");
  await fill(h, "by_service");
  expect(h.result.current.form.groupingApplies).toBe(false);
  expect(h.result.current.form.groupByOptions).toEqual([]);
  act(() => h.result.current.form.setGroupBy("day"));
  expect((await act(() => h.result.current.form.submit())).status).toBe("queued");
  expect(post.mock.calls[0]![1]).not.toHaveProperty("groupBy");
});

it.each(["csv", "xlsx"] as const)(
  "loads every branch page, accepts an inactive branch and queues the exact %s body",
  async (format) => {
    const { f, post, options, persona } = await setup(ANALYTICS, null, 150);
    const h = mount();
    await fill(h, "by_service");
    expect(options.mock.calls.length).toBe(2);
    const inactive = h.result.current.form.branches.items.find((b) => b.id === id(20007))!;
    expect(inactive.isActive).toBe(false);
    act(() => {
      h.result.current.form.setBranchId(inactive.id);
      h.result.current.form.setFormat(format);
      h.result.current.form.setLanguage("en");
    });
    const outcome = await act(() => h.result.current.form.submit());
    expect(outcome.status).toBe("queued");
    expect(post.mock.calls).toEqual([
      [
        persona,
        {
          report: "by_service",
          from: "2026-01-01",
          to: "2026-12-31",
          branchId: inactive.id,
          format,
          language: "en",
        },
      ],
    ]);
    expect(exportJobsOf(f.db).at(-1)!.params).toMatchObject({ branchIds: [inactive.id], format });
    expect(h.result.current.form.queued?.status).toBe("queued");
    expect(h.result.current.form.draft.branchId).toBe(inactive.id);
  },
);

it("all branches omits branchId; a missing report and bad dates never POST", async () => {
  const { post } = await setup(TAKINGS);
  const h = mount();
  expect(await act(() => h.result.current.form.submit())).toEqual({
    status: "blocked",
    issues: [{ field: "report", code: "required" }],
  });
  act(() => {
    h.result.current.form.setReport("daily_takings");
    h.result.current.form.setFrom("2026-02-01");
    h.result.current.form.setTo("2026-01-01");
  });
  await flush();
  expect((await act(() => h.result.current.form.submit())).status).toBe("invalid");
  expect(h.result.current.form.issues.map((i) => i.message)).toContain("validation.dateOrder");
  act(() => h.result.current.form.setFrom(""));
  expect((await act(() => h.result.current.form.submit())).status).toBe("invalid");
  expect(post).not.toHaveBeenCalled();
  act(() => h.result.current.form.setFrom("2026-01-01"));
  expect((await act(() => h.result.current.form.submit())).status).toBe("queued");
  expect(post.mock.calls[0]![1]).not.toHaveProperty("branchId");
  expect(post.mock.calls[0]![1]).toMatchObject({ groupBy: "day", language: "ar" });
});

it("while branches load or fail nothing POSTs; manual retry recovers", async () => {
  const { post, options, realOptions } = await setup(TAKINGS);
  let fail = true;
  options.mockImplementation(async (...args) => {
    if (fail) throw new TypeError("network");
    return realOptions(...args);
  });
  const h = mount();
  act(() => {
    h.result.current.form.setReport("daily_takings");
    h.result.current.form.setFrom("2026-01-01");
    h.result.current.form.setTo("2026-01-31");
  });
  expect(h.result.current.form.branches.isLoading).toBe(true);
  expect((await act(() => h.result.current.form.submit())).status).toBe("blocked");
  await flush();
  expect(h.result.current.form.branches.error).not.toBeNull();
  expect(await act(() => h.result.current.form.submit())).toEqual({
    status: "blocked",
    issues: [{ field: "branchId", code: "not_ready" }],
  });
  expect(post).not.toHaveBeenCalled();
  fail = false;
  await act(async () => void (await h.result.current.form.branches.retry()));
  await flush();
  expect((await act(() => h.result.current.form.submit())).status).toBe("queued");
});

it("a reach change keeps the stale branch and blocks it, never widening to all", async () => {
  const { f, post, persona, api } = await setup(TAKINGS, [f0(), f1()]);
  void f;
  const h = mount();
  await fill(h, "daily_takings");
  act(() => h.result.current.form.setBranchId(f1()));
  getState().members.find((m) => m.id === persona.memberId)!.branchIds = [f0()];
  context.session = await sessionOf(api, persona);
  h.rerender();
  await flush();
  expect(h.result.current.form.draft.branchId).toBe(f1());
  expect(h.result.current.form.branchUnavailable).toBe(true);
  expect(await act(() => h.result.current.form.submit())).toEqual({
    status: "blocked",
    issues: [{ field: "branchId", code: "unavailable" }],
  });
  expect(post).not.toHaveBeenCalled();
  act(() => h.result.current.form.setBranchId(null));
  expect((await act(() => h.result.current.form.submit())).status).toBe("queued");
});
const f0 = () => getState().branches.filter((b) => b.clinicId === getState().clinics[0]!.id)[0]!.id;
const f1 = () => getState().branches.filter((b) => b.clinicId === getState().clinics[0]!.id)[1]!.id;

it("a new report resets branch and grouping but keeps format, dates and language", async () => {
  await setup([...TAKINGS, ...ANALYTICS]);
  const h = mount();
  await fill(h, "daily_takings");
  act(() => {
    h.result.current.form.setBranchId(f0());
    h.result.current.form.setGroupBy("month");
    h.result.current.form.setFormat("xlsx");
    h.result.current.form.setLanguage("en");
    h.result.current.form.setReport("period_summary");
  });
  expect(h.result.current.form.draft).toEqual({
    report: "period_summary",
    from: "2026-01-01",
    to: "2026-12-31",
    branchId: null,
    groupBy: "month",
    format: "xlsx",
    language: "en",
  });
});

it("A→B→A clears the draft, old setters and submit do nothing; permission loss keeps history", async () => {
  const { post, persona, api } = await setup(TAKINGS);
  const sessionA = context.session!;
  const h = mount();
  await fill(h, "daily_takings");
  const oldForm = h.result.current.form;
  await act(() => oldForm.submit());
  const other = personaWith(TAKINGS, null);
  const sessionB = await sessionOf(api, other);
  context.persona = other;
  context.session = sessionB;
  h.rerender();
  context.persona = persona;
  context.session = sessionA;
  h.rerender();
  expect(h.result.current.form.draft.report).toBeNull();
  expect(h.result.current.form.queued).toBeNull();
  act(() => oldForm.setReport("period_summary"));
  expect(h.result.current.form.draft.report).toBeNull();
  expect(await act(() => oldForm.submit())).toEqual({ status: "stale" });
  expect(post).toHaveBeenCalledTimes(1);
  await fill(h, "daily_takings");
  roleOf(persona).permissions = ["view:report_takings:branch"];
  context.session = await sessionOf(api, persona);
  h.rerender();
  expect(h.result.current.form.draft.report).toBe("daily_takings");
  expect(h.result.current.form.reportEligible).toBe(false);
  expect(h.result.current.form.eligibleReports).toEqual([]);
  expect((await act(() => h.result.current.form.submit())).status).toBe("blocked");
  expect(post).toHaveBeenCalledTimes(1);
  const history = await api.reports.listExports(persona, { limit: 25 });
  expect(history.items).toHaveLength(1);
});

it("R6 flags the current clinic-wide balance and still validates and sends its dates", async () => {
  const { post } = await setup(CREDIT);
  const h = mount();
  await fill(h, "patient_credit");
  expect(h.result.current.form.isCurrentClinicWideBalance).toBe(true);
  expect(h.result.current.form.groupingApplies).toBe(false);
  expect((await act(() => h.result.current.form.submit())).status).toBe("queued");
  expect(post.mock.calls[0]![1]).toMatchObject({ from: "2026-01-01", to: "2026-12-31" });
  act(() => h.result.current.form.setFrom(""));
  expect((await act(() => h.result.current.form.submit())).status).toBe("invalid");
});
