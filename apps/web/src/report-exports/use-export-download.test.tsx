import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiClient } from "@/shared/api/api-client";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import type { ReportExport } from "@eyadex/contracts/finance-reports";
import { createMockApiClient } from "@/shared/api/mock/mock-adapter";
import { setup, blobBytes } from "@/shared/api/mock/mock-report-exports.test-kit";
import { personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { publicExportOf } from "@/shared/api/mock/mock-report-export-state";
import { useExportDownload } from "./use-export-download";

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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function fixture() {
  const f = setup();
  const job = await f.finish();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(f.clock());
  const api = createMockApiClient();
  context.api = api;
  context.persona = f.persona;
  context.session = await api.session.getContext(f.persona);
  const row = publicExportOf(job);
  const refresh = vi.fn();
  const h = renderHook(({ rows }: { rows: ReportExport[] }) => useExportDownload(rows, refresh), {
    initialProps: { rows: [row] },
  });
  // jsdom has no URL blob methods; spies model only the browser delivery side, not file bytes.
  const create = vi.fn<(blob: Blob) => string>().mockReturnValue("blob:synthetic-export");
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return { ...f, api, row, refresh, h, create, revoke, click };
}

it.each([false, true])(
  "real CSV download dedupes, names exact metadata and always cleans up (click throws=%s)",
  async (throws) => {
    const f = await fixture();
    let filename = "";
    f.click.mockImplementation(function (this: HTMLAnchorElement) {
      filename = this.download;
      if (throws) throw new Error("Synthetic click failure");
    });
    const call = vi.spyOn(f.api.reports, "downloadExport");
    const audit = structuredClone(f.db.clinicAudit);
    await act(async () => {
      const first = f.h.result.current.download(f.row);
      const second = f.h.result.current.download(f.row);
      expect(first).toBe(second);
      expect(f.create).not.toHaveBeenCalled();
      await first;
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(filename).toBe(`finance-report-${f.row.id}.csv`);
    const blob = f.create.mock.calls[0]?.[0];
    if (!blob || !f.job) {
      /* fixture owns real job */
    }
    if (!blob || !f.row) throw new Error("Missing real Blob");
    const bytes = await blobBytes(blob);
    expect([...bytes.slice(0, 3)]).toStrictEqual([239, 187, 191]);
    expect(new TextDecoder().decode(bytes)).toContain("Branch A,cash,3.000,0.000,3.000,KWD\r\n");
    expect(f.revoke).toHaveBeenCalledExactlyOnceWith("blob:synthetic-export");
    expect(document.querySelector("a[download]")).toBeNull();
    expect(f.h.result.current.pending.size).toBe(0);
    expect(f.db.clinicAudit).toStrictEqual(audit);
  },
);

it.each(["identity", "unmount", "terminal"] as const)(
  "late bytes cannot download after %s",
  async (change) => {
    const f = await fixture();
    const actual = f.api.reports.downloadExport;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(f.api.reports, "downloadExport").mockImplementation(async (p, id) => {
      const blob = await actual(p, id);
      await gate;
      return blob;
    });
    let work: Promise<void> | undefined;
    await act(async () => {
      work = f.h.result.current.download(f.row);
      await Promise.resolve();
    });
    if (change === "identity") {
      context.persona = personaWith([]);
      context.session = await f.api.session.getContext(context.persona);
      f.h.rerender({ rows: [] });
      expect(f.h.result.current.pending.size).toBe(0);
      expect(f.h.result.current.errors).toStrictEqual({});
    } else if (change === "unmount") f.h.unmount();
    else f.h.rerender({ rows: [{ ...f.row, status: "expired" }] });
    await act(async () => {
      release?.();
      await work;
    });
    expect(f.create).not.toHaveBeenCalled();
    expect(f.click).not.toHaveBeenCalled();
  },
);

it.each(["forbidden", "not_found"] as const)(
  "%s marks unavailable even when refreshed metadata stays done",
  async (code) => {
    const f = await fixture();
    if (code === "forbidden") f.role.permissions = [];
    else f.member.branchIds = [f.a.id];
    const get = vi.spyOn(f.api.reports, "getExport");
    const call = vi.spyOn(f.api.reports, "downloadExport");
    await act(async () => {
      await f.h.result.current.download(f.row);
    });
    expect(f.h.result.current.errors[f.row.id]).toBe(code);
    expect(f.h.result.current.unavailable.has(f.row.id)).toBe(true);
    expect(f.h.result.current.canDownload(f.row)).toBe(false);
    expect(get).toHaveBeenCalledWith(f.persona, f.row.id);
    expect(f.refresh).toHaveBeenCalledTimes(1);
    expect((await f.api.reports.getExport(f.persona, f.row.id)).export.status).toBe("done");
    await act(async () => {
      await f.h.result.current.download(f.row);
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(f.create).not.toHaveBeenCalled();
    context.persona = personaWith([]);
    context.session = await f.api.session.getContext(context.persona);
    f.h.rerender({ rows: [] });
    expect(f.h.result.current.unavailable.size).toBe(0);
    expect(f.h.result.current.errors).toStrictEqual({});
  },
);
