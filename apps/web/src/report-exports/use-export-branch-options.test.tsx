import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReportId } from "@eyadex/contracts/finance-reports";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import type { ApiClient } from "@/shared/api/api-client";
import { ApiError } from "@/shared/api/api-error";
import { createMockApiClient } from "@/shared/api/mock/mock-adapter";
import { fixture, id, NOW } from "@/shared/api/mock/mock-report-export.test-kit";
import { as, personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { useExportBranchOptions } from "./use-export-branch-options";

const context = vi.hoisted(() => ({
  api: null as ApiClient | null,
  persona: null as Persona | null,
  session: null as SessionContext | null,
  sessionError: null as Error | null,
}));
vi.mock("@/shared/api/api-provider", () => ({ useApi: () => context.api }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: context.persona, ready: true }),
  useSession: () => ({ session: context.session, isLoading: false, error: context.sessionError }),
}));

const clients: QueryClient[] = [];
function mount(initial: ReportId | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(({ report }) => useExportBranchOptions(report), {
    wrapper,
    initialProps: { report: initial },
  });
}
const flush = (ms = 2000) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  clients.forEach((c) => c.clear());
  clients.length = 0;
  context.sessionError = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const ANALYTICS = ["view:report_analytics:clinic", "view:invoices:clinic"];
/** Real mock state with 150 extra branches (one inactive), the real root client and its session. */
async function setup(keys = ANALYTICS, branchIds: string[] | null = null) {
  const f = fixture();
  for (let i = 0; i < 150; i++)
    f.db.branches.push({
      ...f.a,
      id: id(20000 + i),
      nameAr: `فرع ${i}`,
      nameEn: `Branch ${i}`,
      isActive: i !== 7,
    });
  const api = createMockApiClient();
  const persona = personaWith(keys, branchIds ?? null);
  context.api = api;
  context.persona = persona;
  await loadSession(api, persona);
  const read = vi.spyOn(api.reports, "branchOptions");
  const all = f.db.branches
    .filter((b) => b.clinicId === f.ctx.clinicId)
    .sort((a, b) => a.id.localeCompare(b.id));
  return { f, api, persona, read, all };
}
async function loadSession(api: ApiClient, persona: Persona) {
  const pending = api.session.getContext(persona);
  await vi.advanceTimersByTimeAsync(200);
  context.session = await pending;
}

it("loads every opaque cursor page sequentially at 100 with real names, inactive rows and API order", async () => {
  const { read, all, persona, f } = await setup();
  const h = mount("by_service");
  await flush();
  expect(read.mock.calls.map((c) => c[2])).toEqual([
    { limit: 100 },
    { limit: 100, cursor: expect.any(String) },
  ]);
  const cursor = (await read.mock.results[0]!.value).nextCursor;
  expect(read.mock.calls[1]![2].cursor).toBe(cursor);
  expect(read.mock.calls.every((c) => c[0] === persona && c[1] === "by_service")).toBe(true);
  expect(h.result.current.items).toEqual(
    all.map(({ id, nameAr, nameEn, isActive }) => ({ id, nameAr, nameEn, isActive })),
  );
  expect(h.result.current.items.find((b) => b.id === id(20007))?.isActive).toBe(false);
  expect(h.result.current.items.some((b) => b.clinicId !== undefined)).toBe(false);
  expect(h.result.current.isReady).toBe(true);
  expect(f.db.branches.some((b) => b.clinicId !== f.ctx.clinicId)).toBe(true);
});

it.each([
  ["cash_closings", ["view:report_takings:branch", "view:cash_closings:branch"], false],
  ["own_summary", ["view:report_own:own", "view:invoices:own"], true],
  ["by_doctor", ["view:report_analytics:branch", "view:invoices:branch"], false],
] as const)("%s reads exactly its own report reach", async (report, keys, all) => {
  const f = fixture();
  const api = createMockApiClient();
  context.api = api;
  context.persona = personaWith([...keys], [f.a.id]);
  await loadSession(api, context.persona);
  const h = mount(report);
  await flush();
  const clinic = f.db.branches.filter((b) => b.clinicId === f.ctx.clinicId).map((b) => b.id);
  expect(h.result.current.items.map((b) => b.id).sort()).toEqual(all ? clinic.sort() : [f.a.id]);
});

it("makes no branch call without a report, a covering key, or with an uncovered wider key", async () => {
  const { read } = await setup(["view:report_analytics:clinic", "view:invoices:branch"], []);
  const h = mount(null);
  await flush();
  h.rerender({ report: "by_service" });
  await flush();
  h.rerender({ report: "daily_takings" });
  await flush();
  expect(read).not.toHaveBeenCalled();
  expect(h.result.current).toMatchObject({ items: [], isEligible: false, error: null });
});

it("publishes nothing after a later-page failure and recovers on manual retry", async () => {
  const { read, all } = await setup();
  const real = read.getMockImplementation() ?? null;
  expect(real).toBeNull();
  let calls = 0;
  const original = context.api!.reports.branchOptions;
  read.mockImplementation(async (...args) => {
    calls += 1;
    if (calls === 2) throw new ApiError("unknown");
    return read.mock.calls.length ? await callThrough(original, args) : await callThrough(original, args);
  });
  const h = mount("by_service");
  await flush();
  expect(h.result.current.items).toEqual([]);
  expect(h.result.current.error).toBe("unknown");
  expect(calls).toBe(2);
  await act(async () => void (await h.result.current.retry()));
  await flush();
  expect(h.result.current.items).toHaveLength(all.length);
  expect(h.result.current.error).toBeNull();
});
function callThrough(fn: ApiClient["reports"]["branchOptions"], args: unknown[]) {
  return vi.mocked(fn).getMockImplementation()
    ? (Object.getPrototypeOf(fn) as never)
    : (vi.mocked(fn) as unknown as { mock: unknown }) && originalOf(fn)(...(args as [never, never, never]));
}
function originalOf(fn: ApiClient["reports"]["branchOptions"]) {
  return (fn as unknown as { __original: typeof fn }).__original;
}

it("finance off, blocked clinic, session error and denied refresh hide options without calls", async () => {
  const { read, api, persona, f } = await setup();
  const h = mount("by_service");
  await flush();
  expect(h.result.current.items.length).toBeGreaterThan(100);
  read.mockClear();
  context.session = { ...context.session!, features: { ...context.session!.features, finance: false } };
  h.rerender({ report: "by_service" });
  expect(h.result.current.items).toEqual([]);
  context.session = { ...context.session!, features: { ...context.session!.features, finance: true }, blocked: "suspended" };
  h.rerender({ report: "by_service" });
  expect(h.result.current.items).toEqual([]);
  context.sessionError = new ApiError("unknown");
  h.rerender({ report: "by_service" });
  await flush();
  expect(read).not.toHaveBeenCalled();
  expect(h.result.current).toMatchObject({ items: [], error: "unknown" });
  context.sessionError = null;
  await loadSession(api, persona);
  h.rerender({ report: "by_service" });
  await flush();
  expect(h.result.current.items.length).toBeGreaterThan(100);
  const role = f.db.roles.find((r) => r.id === f.db.members.find((m) => m.id === persona.memberId)!.roleId)!;
  role.permissions = ["view:report_analytics:clinic"];
  await act(async () => void (await h.result.current.refresh()));
  await flush();
  expect(h.result.current).toMatchObject({ items: [], error: "forbidden" });
});

it("report and reach changes discard old options; A→B→A and unmount never start an old tail", async () => {
  const { read, api, persona, f } = await setup(
    ["view:report_analytics:branch", "view:invoices:branch", "view:report_takings:clinic", "view:payments:clinic"],
    [f0()],
  );
  void f;
  const h = mount("by_service");
  await flush(50);
  expect(read).toHaveBeenCalledTimes(1);
  h.rerender({ report: "daily_takings" });
  expect(h.result.current.items).toEqual([]);
  h.rerender({ report: "by_service" });
  expect(h.result.current.items).toEqual([]);
  await flush();
  // the first by_service run was aborted after its slow first page: no old tail call was started
  const tails = read.mock.calls.filter((c) => c[2].cursor !== undefined);
  expect(tails.every((c) => c[1] === "by_service")).toBe(true);
  expect(h.result.current.items.map((b) => b.id)).toEqual([f0()]);
  const member = getMember(persona);
  member.branchIds = [];
  await loadSession(api, persona);
  h.rerender({ report: "by_service" });
  expect(h.result.current.items).toEqual([]);
  read.mockClear();
  const g = mount("daily_takings");
  await flush(50);
  g.unmount();
  await flush();
  expect(read.mock.calls.filter((c) => c[1] === "daily_takings")).toHaveLength(1);
});
let firstBranch = "";
function f0() {
  return firstBranch;
}
function getMember(persona: Persona) {
  return getStateMember(persona);
}
declare function getStateMember(p: Persona): { branchIds: string[] };
