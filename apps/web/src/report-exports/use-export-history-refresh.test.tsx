import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ApiClient } from "@/shared/api/api-client";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import { createMockApiClient } from "@/shared/api/mock/mock-adapter";
import { setup } from "@/shared/api/mock/mock-report-exports.test-kit";
import { useExportHistory } from "./use-export-history";

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
const flush = (ms = 10) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
beforeEach(() =>
  vi.useFakeTimers({
    toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  }),
);
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function fixture() {
  const f = setup();
  vi.setSystemTime(f.clock());
  const api = createMockApiClient();
  Object.assign(context, { api, persona: f.persona });
  const session = api.session.getContext(f.persona);
  await vi.advanceTimersByTimeAsync(80);
  context.session = await session;
  // Real lifecycle: each job is read until it is terminal, so the queue never fills.
  const finished = async (n: number) => {
    for (let i = 0; i < n; i++) {
      const queued = await api.reports.requestExport(f.persona, f.body);
      vi.setSystemTime(Date.now() + 1000);
      await api.reports.getExport(f.persona, queued.export.id);
      vi.setSystemTime(Date.now() + 1000);
      await api.reports.getExport(f.persona, queued.export.id);
    }
  };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const mount = () => renderHook(() => useExportHistory(), { wrapper });
  return { ...f, root: api, finished, mount };
}

it("20 loaded + 25 newer jobs from another tab refresh to all 45, by cursor pages only", async () => {
  const f = await fixture();
  await f.finished(20);
  const h = f.mount();
  await flush();
  expect(h.result.current.items).toHaveLength(20);
  await f.finished(25);
  const list = vi.spyOn(f.root.reports, "listExports");
  const get = vi.spyOn(f.root.reports, "getExport");
  await act(async () => void (await h.result.current.refresh()));
  await flush();
  expect(h.result.current.items).toHaveLength(45);
  expect(new Set(h.result.current.items.map((r) => r.id)).size).toBe(45);
  expect(h.result.current.total).toBe(45);
  expect(h.result.current.hasMore).toBe(false);
  expect(get).not.toHaveBeenCalled();
  expect(list.mock.calls.length).toBeGreaterThan(1);
  expect(list.mock.calls[0]?.[1]).toStrictEqual({});
});

it("a refresh carries fresh expiry metadata for loaded rows", async () => {
  const f = await fixture();
  await f.finished(3);
  const h = f.mount();
  await flush();
  expect(h.result.current.items.every((r) => r.status === "done")).toBe(true);
  vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
  await act(async () => void (await h.result.current.refresh()));
  await flush();
  expect(h.result.current.items).toHaveLength(3);
  expect(h.result.current.items.every((r) => r.status !== "done")).toBe(true);
});

it("unmount during the page walk never starts the next page", async () => {
  const f = await fixture();
  await f.finished(20);
  const h = f.mount();
  await flush();
  await f.finished(45);
  const actual = f.root.reports.listExports;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const list = vi.spyOn(f.root.reports, "listExports").mockImplementation(async (p, q) => {
    const page = await actual(p, q);
    if (q.cursor) await gate;
    return page;
  });
  void h.result.current.refresh();
  await flush();
  const calls = list.mock.calls.length;
  expect(calls).toBe(2);
  h.unmount();
  release();
  await flush(4000);
  expect(list).toHaveBeenCalledTimes(calls);
});
