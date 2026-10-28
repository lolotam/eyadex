import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  reportExportRequestSchema,
  type ReportExportRequest,
} from "@eyadex/contracts/finance-reports";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import type { ApiClient } from "@/shared/api/api-client";
import { ApiError } from "@/shared/api/api-error";
import { createMockApiClient } from "@/shared/api/mock/mock-adapter";
import { fixture, NOW } from "@/shared/api/mock/mock-report-export.test-kit";
import { getState, personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { exportJobsOf } from "@/shared/api/mock/mock-report-export-state";
import { useRequestExport } from "./use-request-export";

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
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useRequestExport(), { wrapper });
}
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
const body = (changes: Partial<ReportExportRequest> = {}): ReportExportRequest => ({
  report: "daily_takings",
  format: "csv",
  language: "en",
  from: "2026-01-01",
  to: "2026-12-31",
  ...changes,
});
async function sessionOf(api: ApiClient, persona: Persona) {
  const pending = api.session.getContext(persona);
  await vi.advanceTimersByTimeAsync(200);
  return pending;
}
async function setup(keys: string[] = TAKINGS) {
  const f = fixture();
  const api = createMockApiClient();
  const persona = personaWith(keys, [f.a.id, f.b.id]);
  context.api = api;
  context.persona = persona;
  context.session = await sessionOf(api, persona);
  const real = api.reports.requestExport.bind(api.reports);
  const post = vi.spyOn(api.reports, "requestExport");
  return { f, api, persona, real, post };
}
/** Holds the real POST until `release` runs; the adapter still decides the answer. */
function hold(post: ReturnType<typeof vi.spyOn>, real: ApiClient["reports"]["requestExport"]) {
  const gates: Array<() => void> = [];
  post.mockImplementation(async (...args: Parameters<typeof real>) => {
    await new Promise<void>((r) => gates.push(r));
    return real(...args);
  });
  return () => gates.shift()?.();
}
const historyKey = (s: SessionContext, p: Persona, epoch = 0) => [
  "clinic",
  "report-exports",
  p.kind,
  p.clinicId,
  p.memberId,
  s.clinic?.id,
  s.membershipId,
  epoch,
];

it.each([
  [body({ format: "csv", language: "ar", groupBy: "month" })],
  [body({ format: "xlsx", language: "en", groupBy: "day" })],
])("queues the exact validated body %# and refreshes only the requester history", async (input) => {
  const { f, post, persona } = await setup();
  const withBranch = { ...input, branchId: f.a.id };
  const h = mount();
  const mine = historyKey(context.session!, persona);
  const other = ["clinic", "report-exports", "custom", persona.clinicId, "someone-else", 0];
  client.setQueryData(mine, { items: [] });
  client.setQueryData(other, { items: [] });
  let outcome: Awaited<ReturnType<typeof h.result.current.submit>> | undefined;
  await act(async () => {
    outcome = await h.result.current.submit(withBranch);
  });
  expect(outcome?.status === "invalid" ? outcome.issues : []).toEqual([]);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0]).toEqual([persona, reportExportRequestSchema.parse(withBranch)]);
  const job = exportJobsOf(f.db).at(-1)!;
  expect(outcome).toEqual({
    status: "queued",
    export: expect.objectContaining({ id: job.id, status: "queued" }),
  });
  expect(h.result.current.queued?.id).toBe(job.id);
  expect(job.params).toMatchObject({
    language: withBranch.language,
    groupBy: withBranch.groupBy,
    branchIds: [f.a.id],
  });
  expect(client.getQueryState(mine)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
});

it("uses the real schema: 1096 days passes, over-range, inverted and wrong grouping never POST", async () => {
  const { post } = await setup([
    ...TAKINGS,
    "view:report_analytics:branch",
    "view:invoices:branch",
  ]);
  const h = mount();
  const run = (input: ReportExportRequest) => act(() => h.result.current.submit(input));
  expect(await run(body({ from: "2026-01-01", to: "2028-12-31" }))).toMatchObject({
    status: "queued",
  });
  post.mockClear();
  for (const [input, message] of [
    [body({ from: "2026-01-01", to: "2029-01-01" }), "validation.rangeTooLong"],
    [body({ from: "2026-02-01", to: "2026-01-01" }), "validation.dateOrder"],
    [body({ report: "by_service", groupBy: "day" }), "validation.required"],
  ] as const) {
    const outcome = await run(input);
    expect(outcome.status).toBe("invalid");
    expect(h.result.current.issues.map((i) => i.message)).toContain(message);
  }
  const shape = await run({ ...body(), extra: 1 } as ReportExportRequest);
  expect(shape).toEqual({ status: "invalid", issues: [{ path: "", message: null }] });
  expect(post).not.toHaveBeenCalled();
});

it("gates on report key + covering key, refuses an uncovered wider key, needs no unrelated key", async () => {
  const { post } = await setup(["view:report_analytics:clinic", "view:invoices:branch"]);
  const h = mount();
  expect(h.result.current.isEligibleFor("by_service")).toBe(false);
  expect(await act(() => h.result.current.submit(body({ report: "by_service" })))).toEqual({
    status: "ineligible",
  });
  expect(post).not.toHaveBeenCalled();
  const g = await setup(["view:report_analytics:branch", "view:invoices:branch"]);
  const k = mount();
  expect((await act(() => k.result.current.submit(body({ report: "by_service" })))).status).toBe(
    "queued",
  );
  expect(g.post).toHaveBeenCalledTimes(1);
});

it("synchronous duplicate calls send one POST and get a non-submitted answer", async () => {
  const { post, real } = await setup();
  const release = hold(post, real);
  const h = mount();
  let first!: Promise<unknown>;
  let second: unknown;
  act(() => {
    first = h.result.current.submit(body());
    void h.result.current.submit(body()).then((o) => (second = o));
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(second).toEqual({ status: "duplicate" });
  expect(h.result.current.isPending).toBe(true);
  release();
  await act(async () => void (await first));
  expect(post).toHaveBeenCalledTimes(1);
  expect(h.result.current.isPending).toBe(false);
});

it("keeps real catalogue codes, never retries itself, and recovers on a manual retry", async () => {
  const { post, persona, api } = await setup();
  for (let i = 0; i < 10; i++) await api.reports.requestExport(persona, body());
  post.mockClear();
  const h = mount();
  expect(await act(() => h.result.current.submit(body()))).toEqual({
    status: "failed",
    error: "export_busy",
  });
  expect(h.result.current.error).toBe("export_busy");
  await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
  expect(post).toHaveBeenCalledTimes(1);
  exportJobsOf(getState()).splice(0);
  post.mockRejectedValueOnce(new TypeError("network"));
  expect((await act(() => h.result.current.submit(body()))).status).toBe("failed");
  expect((await act(() => h.result.current.submit(body()))).status).toBe("queued");
  expect(h.result.current.error).toBeNull();
  const role = getState().roles.find(
    (r) => r.id === getState().members.find((m) => m.id === persona.memberId)!.roleId,
  )!;
  role.permissions = ["view:report_takings:branch"];
  expect(await act(() => h.result.current.submit(body()))).toEqual({
    status: "failed",
    error: "forbidden",
  });
  getState().members.find((m) => m.id === persona.memberId)!.status = "deactivated";
  expect(await act(() => h.result.current.submit(body()))).toEqual({
    status: "failed",
    error: "account_disabled",
  });
});

it("A→B→A: the old pending POST stays stale, does not block or invalidate the current actor", async () => {
  const { post, real, persona, api, f } = await setup();
  const sessionA = context.session!;
  const release = hold(post, real);
  const h = mount();
  let old!: Promise<unknown>;
  act(() => {
    old = h.result.current.submit(body());
  });
  const other = personaWith(TAKINGS, [f.a.id]);
  const sessionB = await sessionOf(api, other);
  context.persona = other;
  context.session = sessionB;
  h.rerender();
  expect(h.result.current.isPending).toBe(false);
  context.persona = persona;
  context.session = sessionA;
  h.rerender();
  expect(h.result.current.isPending).toBe(false);
  const mine = historyKey(sessionA, persona, 2);
  client.setQueryData(mine, { items: [] });
  let fresh!: Promise<unknown>;
  act(() => {
    fresh = h.result.current.submit(body({ format: "xlsx" }));
  });
  expect(h.result.current.isPending).toBe(true);
  release();
  expect(await act(() => old)).toEqual({ status: "stale" });
  expect(h.result.current.isPending).toBe(true);
  expect(client.getQueryState(mine)?.isInvalidated).toBe(false);
  release();
  expect(await act(() => fresh)).toMatchObject({ status: "queued" });
  expect(post).toHaveBeenCalledTimes(2);
  expect(h.result.current.queued?.format).toBe("xlsx");
});

it("unmount during a slow POST publishes nothing and reports stale", async () => {
  const { post, real, persona } = await setup();
  const release = hold(post, real);
  const h = mount();
  const mine = historyKey(context.session!, persona);
  client.setQueryData(mine, { items: [] });
  let late!: Promise<unknown>;
  act(() => {
    late = h.result.current.submit(body());
  });
  h.unmount();
  release();
  expect(await late).toEqual({ status: "stale" });
  expect(client.getQueryState(mine)?.isInvalidated).toBe(false);
});
