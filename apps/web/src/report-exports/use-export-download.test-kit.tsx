// Shared setup for the download hook tests: the real mock client, a done export and a mounted hook.
import { cleanup, renderHook } from "@testing-library/react";
import { vi } from "vitest";
import type { ApiClient } from "@/shared/api/api-client";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import type { ReportExport } from "@eyadex/contracts/finance-reports";
import { createMockApiClient } from "@/shared/api/mock/mock-adapter";
import { setup } from "@/shared/api/mock/mock-report-exports.test-kit";
import { publicExportOf } from "@/shared/api/mock/mock-report-export-state";
import { useExportDownload } from "./use-export-download";

/** What the mocked providers hand to the real hook; each test file mocks them onto this. */
export const context = {
  api: null as ApiClient | null,
  persona: null as Persona | null,
  session: null as SessionContext | null,
};

export function restoreDownloadTest() {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
}

export async function fixture() {
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
      static override createObjectURL = create;
      static override revokeObjectURL = revoke;
    },
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return { ...f, api, row, refresh, h, create, revoke, click };
}
