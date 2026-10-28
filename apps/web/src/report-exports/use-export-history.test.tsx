import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ApiClient } from "@/shared/api/api-client";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import { createMockApiClient } from "@/shared/api/mock/mock-adapter";
import { setup } from "@/shared/api/mock/mock-report-exports.test-kit";
import { personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { ApiError } from "@/shared/api/api-error";
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
const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useExportHistory(), { wrapper }) };
}
async function flush(ms = 10) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() =>
  vi.useFakeTimers({
    toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  }),
);
afterEach(() => {
  cleanup();
  clients.forEach((c) => c.clear());
  clients.length = 0;
  vi.useRealTimers();
});
async function fixture() {
  const f = setup();
  vi.setSystemTime(f.clock());
  const api = createMockApiClient();
  context.api = api;
  context.persona = f.persona;
  const session = api.session.getContext(f.persona);
  await vi.advanceTimersByTimeAsync(80);
  context.session = await session;
  return { ...f, root: api };
}

it("loads real pages, keeps tails on head refresh, dedupes and retries page/head errors manually", async () => {
  const f = await fixture();
  for (let i = 0; i < 25; i++)
    await f.root.reports
      .requestExport(f.persona, { ...f.body, format: i % 2 ? "csv" : "xlsx" })
      .then(async (queued) => {
        vi.setSystemTime(Date.now() + 1000);
        await f.root.reports.getExport(f.persona, queued.export.id);
        vi.setSystemTime(Date.now() + 1000);
        await f.root.reports.getExport(f.persona, queued.export.id);
      });
  const read = vi.spyOn(f.root.reports, "listExports");
  const h = mount();
  await flush();
  expect(h.result.current.items).toHaveLength(20);
  read.mockRejectedValueOnce(new ApiError("unknown"));
  await act(async () => {
    await h.result.current.loadMore();
  });
  await flush();
  expect(h.result.current.pageError).toBe("unknown");
  await act(async () => {
    await h.result.current.loadMore();
  });
  await flush();
  expect(h.result.current.items).toHaveLength(25);
  expect(h.result.current.hasMore).toBe(false);
  const queued = await f.root.reports.requestExport(f.persona, f.body);
  await act(async () => {
    await h.result.current.refresh();
  });
  await flush();
  expect(h.result.current.items).toHaveLength(26);
  expect(h.result.current.items[0]?.id).toBe(queued.export.id);
  expect(new Set(h.result.current.items.map((r) => r.id)).size).toBe(26);
  read.mockRejectedValueOnce(new ApiError("module_disabled"));
  await act(async () => {
    await h.result.current.refresh();
  });
  await flush();
  expect(h.result.current.error).toBe("module_disabled");
  const calls = read.mock.calls.length;
  await flush(6000);
  expect(read).toHaveBeenCalledTimes(calls);
  await act(async () => {
    await h.result.current.retry();
  });
  await flush();
  expect(h.result.current.error).toBeNull();
  expect(h.result.current.items).toHaveLength(26);
});

it("polls real queued/running to terminal, stops at terminal and unmount, and keeps metadata after key loss", async () => {
  const f = await fixture();
  await f.root.reports.requestExport(f.persona, f.body);
  const read = vi.spyOn(f.root.reports, "listExports");
  const h = mount();
  await flush();
  expect(h.result.current.items[0]?.status).toBe("queued");
  await flush(2000);
  expect(h.result.current.items[0]?.status).toBe("running");
  await flush(2000);
  expect(h.result.current.items[0]?.status).toBe("done");
  const count = read.mock.calls.length;
  await flush(6000);
  expect(read).toHaveBeenCalledTimes(count);
  f.role.permissions = [];
  await act(async () => {
    await h.result.current.refresh();
  });
  await flush();
  expect(h.result.current.items[0]?.status).toBe("done");
  h.unmount();
  await flush(4000);
  expect(read).toHaveBeenCalledTimes(count + 1);
});

it("coalesces slow polls and discards an old request when membership changes, without flashing old rows", async () => {
  const f = await fixture();
  await f.root.reports.requestExport(f.persona, f.body);
  const actual = f.root.reports.listExports;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const read = vi.spyOn(f.root.reports, "listExports").mockImplementation(async (p, q) => {
    const result = await actual(p, q);
    await gate;
    return result;
  });
  const h = mount();
  await flush();
  await flush(8000);
  expect(read).toHaveBeenCalledTimes(1);
  const other = personaWith([]);
  context.persona = other;
  const session = f.root.session.getContext(other);
  await vi.advanceTimersByTimeAsync(80);
  context.session = await session;
  h.rerender();
  expect(h.result.current.items).toStrictEqual([]);
  read.mockImplementation(actual);
  release?.();
  await flush();
  expect(h.result.current.items).toStrictEqual([]);
  expect(h.result.current.error).toBeNull();
  await flush(4000);
  expect(read).toHaveBeenCalledTimes(2);
});

it("unmount cancels active polling even while queued and discards a late page", async () => {
  const f = await fixture();
  await f.root.reports.requestExport(f.persona, f.body);
  const read = vi.spyOn(f.root.reports, "listExports");
  const h = mount();
  await flush();
  h.unmount();
  const count = read.mock.calls.length;
  await flush(8000);
  expect(read).toHaveBeenCalledTimes(count);
});
