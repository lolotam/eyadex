import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import type { ApiClient } from "@/shared/api/api-client";
import { ApiError } from "@/shared/api/api-error";
import { createMockApiClient } from "@/shared/api/mock/mock-adapter";
import { blobBytes, setup } from "@/shared/api/mock/mock-report-exports.test-kit";
import { EXPORT_STEP_MS } from "@/shared/api/mock/mock-report-export-run";
import { personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { en } from "@/shared/i18n/en";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ExportHistory } from "./export-history";

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
const t = en.reportExports;
let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  window.localStorage.setItem("eyadex:language", "en");
});
afterEach(() => {
  cleanup();
  client?.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});
async function flush(ms = 10) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function mount(before?: (api: ApiClient) => void) {
  const f = setup();
  vi.setSystemTime(f.clock());
  const api = createMockApiClient();
  context.api = api;
  context.persona = f.persona;
  const session = api.session.getContext(f.persona);
  await vi.advanceTimersByTimeAsync(80);
  context.session = await session;
  before?.(api);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = () => (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ExportHistory />
      </I18nProvider>
    </QueryClientProvider>
  );
  const r = render(view());
  return { ...f, root: api, rerender: () => r.rerender(view()) };
}
const advance = async (f: { tick: (ms?: number) => void; clock: () => Date }) => {
  f.tick(EXPORT_STEP_MS);
  vi.setSystemTime(f.clock());
  await flush(2100);
};

it("shows loading then empty, with a heading and no list", async () => {
  await mount();
  expect(screen.getByText(t.loading)).toHaveAttribute("aria-busy", "true");
  await flush(200);
  expect(screen.getByRole("heading", { name: t.title })).toBeInTheDocument();
  expect(screen.getByText(t.empty)).toBeInTheDocument();
  expect(screen.queryByRole("list")).toBeNull();
});

it("follows a real job queued -> running -> done and downloads once with the real file", async () => {
  const f = await mount();
  await flush(200);
  await act(async () => {
    await f.root.reports.requestExport(f.persona, f.body);
  });
  fireEvent.click(screen.getByRole("button", { name: t.refresh }));
  await flush(200);
  expect(screen.getByTestId("export-row")).toHaveTextContent(t.statuses.queued);
  expect(screen.getByText("Showing 1 of 1")).toBeInTheDocument();
  await advance(f);
  expect(screen.getByTestId("export-row")).toHaveTextContent(t.statuses.running);
  for (let i = 0; i < 4 && !screen.getByTestId("export-row").textContent?.includes(t.statuses.done); i += 1)
    await advance(f);
  const row = screen.getByTestId("export-row");
  expect(row).toHaveTextContent(t.statuses.done);
  expect(row).not.toHaveTextContent(/reportExports\.|byte/i);
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-export");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  let filename = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    filename = this.download;
  });
  const call = vi.spyOn(f.root.reports, "downloadExport");
  const button = screen.getByRole("button", { name: "Download Daily takings (CSV)" });
  await act(async () => {
    fireEvent.click(button);
    fireEvent.click(button);
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(call).toHaveBeenCalledTimes(1);
  const job = f.db && (await f.root.reports.listExports(f.persona, {})).items[0];
  expect(filename).toBe(`finance-report-${job?.id}.csv`);
  const blob = create.mock.calls[0]?.[0];
  if (!(blob instanceof Blob)) throw new Error("Missing real Blob");
  expect([...(await blobBytes(blob)).slice(0, 3)]).toStrictEqual([239, 187, 191]);
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:synthetic-export");
});

it("keeps own history after report-key loss but hides a refused download", async () => {
  const f = await mount();
  await flush(200);
  await act(async () => {
    await f.finish();
  });
  vi.setSystemTime(f.clock());
  fireEvent.click(screen.getByRole("button", { name: t.refresh }));
  await flush(200);
  f.role.permissions = [];
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Download/ }));
    await vi.advanceTimersByTimeAsync(300);
  });
  const row = screen.getByTestId("export-row");
  expect(row).toHaveTextContent(t.statuses.done);
  expect(row).toHaveTextContent(t.unavailable);
  expect(screen.queryByRole("button", { name: /Download/ })).toBeNull();
});

it("shows head errors with manual retry, keeps rows on refresh error and drops them on identity change", async () => {
  let list = null as unknown as ReturnType<typeof vi.spyOn<ApiClient["reports"], "listExports">>;
  const f = await mount((api) => {
    list = vi.spyOn(api.reports, "listExports");
    list.mockRejectedValueOnce(new ApiError("module_disabled", 403));
  });
  await flush(200);
  expect(screen.getByRole("alert")).toHaveTextContent(en.errors.module_disabled);
  await act(async () => {
    const pending = f.root.reports.requestExport(f.persona, f.body);
    await vi.advanceTimersByTimeAsync(100);
    await pending;
  });
  fireEvent.click(screen.getByRole("button", { name: t.retry }));
  await flush(200);
  expect(screen.getAllByTestId("export-row")).toHaveLength(1);
  list.mockRejectedValueOnce(new ApiError("unknown", 500));
  fireEvent.click(screen.getByRole("button", { name: t.refresh }));
  await flush(200);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.getAllByTestId("export-row")).toHaveLength(1);
  expect(screen.queryByText(t.empty)).toBeNull();
  await flush(5000);
  expect(list).toHaveBeenCalledTimes(3);
  context.persona = personaWith([]);
  const next = f.root.session.getContext(context.persona);
  await vi.advanceTimersByTimeAsync(80);
  context.session = await next;
  f.rerender();
  expect(screen.queryAllByTestId("export-row")).toHaveLength(0);
});

it("loads more pages, and a page error keeps rows with manual retry", async () => {
  const f = await mount();
  await flush(200);
  await act(async () => {
    for (let i = 0; i < 13; i += 1) await f.finish();
    for (let i = 0; i < 10; i += 1) await f.root.reports.requestExport(f.persona, f.body).catch(() => null);
  });
  vi.setSystemTime(f.clock());
  fireEvent.click(screen.getByRole("button", { name: t.refresh }));
  await flush(200);
  const shown = screen.getAllByTestId("export-row").length;
  expect(shown).toBe(20);
  const list = vi.spyOn(f.root.reports, "listExports");
  list.mockRejectedValueOnce(new ApiError("unknown", 500));
  fireEvent.click(screen.getByRole("button", { name: t.loadMore }));
  await flush(100);
  expect(screen.getByRole("alert")).toHaveTextContent(t.pageError);
  expect(screen.getAllByTestId("export-row")).toHaveLength(20);
  fireEvent.click(screen.getByRole("button", { name: t.retry }));
  await flush(200);
  expect(screen.getAllByTestId("export-row").length).toBeGreaterThan(20);
});
