// #143: a render React abandons must not move the hook's committed identity. This test proves only
// this: an abandoned transition render for another scope or a not-ready session does not stale or
// duplicate an in-flight download. It does not prove every concurrent interleaving is safe.
import { act, render } from "@testing-library/react";
import {
  createContext,
  startTransition,
  Suspense,
  use,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import type { ReportExport } from "@eyadex/contracts/finance-reports";
import { createMockApiClient } from "@/shared/api/mock/mock-adapter";
import { setup } from "@/shared/api/mock/mock-report-exports.test-kit";
import { publicExportOf } from "@/shared/api/mock/mock-report-export-state";
import { context, restoreDownloadTest } from "./use-export-download.test-kit";
import { useExportDownload } from "./use-export-download";

type Who = { persona: Persona; session: SessionContext | null; ready: boolean };
const Identity = createContext<Who | null>(null);

vi.mock("@/shared/api/api-provider", () => ({ useApi: () => context.api }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => {
    const who = useContext(Identity)!;
    return { persona: who.persona, ready: who.ready };
  },
  useSession: () => ({ session: useContext(Identity)!.session, isLoading: false, error: null }),
}));
afterEach(restoreDownloadTest);

const never = new Promise<never>(() => {});
function Suspender(): null {
  use(never);
  return null;
}

const handle: { current: ReturnType<typeof useExportDownload> | null } = { current: null };
function Consumer({ rows }: { rows: ReportExport[] }) {
  const result = useExportDownload(rows, () => undefined);
  // Only committed handlers reach a user's click, so the test calls what the last commit exposed.
  useLayoutEffect(() => {
    handle.current = result;
  });
  return null;
}

let switchTo: (who: Who) => void = () => {};
function Harness({ first, rows }: { first: Who; rows: ReportExport[] }) {
  const [who, setWho] = useState(first);
  switchTo = (next) => startTransition(() => setWho(next));
  return (
    <Identity.Provider value={who}>
      <Suspense fallback={null}>
        <Consumer rows={rows} />
        {who === first ? null : <Suspender />}
      </Suspense>
    </Identity.Provider>
  );
}

it.each(["another persona", "a not-ready session"] as const)(
  "an abandoned transition render for %s neither stales nor duplicates an in-flight download",
  async (kind) => {
    const f = setup();
    const job = await f.finish();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(f.clock());
    const api = createMockApiClient();
    context.api = api;
    const session = await api.session.getContext(f.persona);
    const row = publicExportOf(job);
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
    const actual = api.reports.downloadExport;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const call = vi.spyOn(api.reports, "downloadExport").mockImplementation(async (p, id) => {
      const blob = await actual(p, id);
      await gate;
      return blob;
    });
    const first: Who = { persona: f.persona, session, ready: true };
    render(<Harness first={first} rows={[row]} />);
    let work: Promise<void> = Promise.resolve();
    await act(async () => {
      work = handle.current!.download(row);
    });
    const other: Who =
      kind === "another persona"
        ? {
            persona: { ...f.persona, memberId: "00000000-0000-7000-8000-0000000000b2" },
            session: null,
            ready: true,
          }
        : { persona: f.persona, session, ready: false };
    await act(async () => {
      switchTo(other);
    });
    // The transition suspended and was never committed; the committed consumer still owns the request.
    expect(handle.current!.download(row)).toBe(work);
    await act(async () => {
      release();
      await work;
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:synthetic-export");
    expect(handle.current!.pending.size).toBe(0);
  },
);
