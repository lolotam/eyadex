import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createContext, startTransition, use, useContext, useState, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Persona, SessionContext } from "@eyadex/contracts/session";
import type { ApiClient } from "@/shared/api/api-client";
import { createMockApiClient } from "@/shared/api/mock/mock-adapter";
import { fixture, NOW } from "@/shared/api/mock/mock-report-export.test-kit";
import { personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { useExportForm } from "./use-export-form";

type Actor = { persona: Persona; session: SessionContext };
// The actor comes from React state here, so a transition can render B speculatively.
const ActorContext = vi.hoisted(() => ({ current: null as unknown }));
const api = vi.hoisted(() => ({ current: null as ApiClient | null }));
vi.mock("@/shared/api/api-provider", () => ({ useApi: () => api.current }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({
    persona: useContext(ActorContext.current as React.Context<Actor>).persona,
    ready: true,
  }),
  useSession: () => ({
    session: useContext(ActorContext.current as React.Context<Actor>).session,
    isLoading: false,
    error: null,
  }),
}));
const Actors = createContext<Actor>(null as never);
ActorContext.current = Actors;

let client: QueryClient;
let switchTo: (who: "A" | "B") => void = () => undefined;
const never = new Promise<never>(() => undefined);
function Hold({ on }: { on: boolean }) {
  if (on) use(never);
  return null;
}
const flush = (ms = 2000) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  client?.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const TAKINGS = ["view:report_takings:branch", "view:payments:branch"];
async function sessionOf(persona: Persona) {
  const pending = api.current!.session.getContext(persona);
  await vi.advanceTimersByTimeAsync(200);
  return pending;
}
async function setup(holdB: boolean) {
  fixture();
  api.current = createMockApiClient();
  const a = personaWith(TAKINGS);
  const b = personaWith(TAKINGS);
  const actors = {
    A: { persona: a, session: await sessionOf(a) },
    B: { persona: b, session: await sessionOf(b) },
  };
  const post = vi.spyOn(api.current.reports, "requestExport");
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Root({ children }: { children: ReactNode }) {
    const [who, setWho] = useState<"A" | "B">("A");
    switchTo = setWho;
    return (
      <QueryClientProvider client={client}>
        <I18nProvider>
          <Actors.Provider value={actors[who]}>
            <Hold on={holdB && who === "B"} />
            {children}
          </Actors.Provider>
        </I18nProvider>
      </QueryClientProvider>
    );
  }
  const h = renderHook(() => useExportForm(), { wrapper: Root });
  await flush();
  return { h, post };
}
const fill = async (h: Awaited<ReturnType<typeof setup>>["h"]) => {
  act(() => {
    h.result.current.setReport("daily_takings");
    h.result.current.setFrom("2026-01-01");
    h.result.current.setTo("2026-01-31");
  });
  await flush();
};

it("an abandoned B transition leaves A's setters and submit working with one POST", async () => {
  const { h, post } = await setup(true);
  await fill(h);
  act(() => startTransition(() => switchTo("B")));
  await flush();
  console.log("DBG", JSON.stringify(h.result.current.draft));
  act(() => h.result.current.setTo("2026-02-28"));
  console.log("DBG2", JSON.stringify(h.result.current.draft));
  await flush();
  expect(h.result.current.draft.to).toBe("2026-02-28");
  let outcome: Awaited<ReturnType<typeof h.result.current.submit>> | undefined;
  await act(async () => {
    outcome = await h.result.current.submit();
  });
  expect(outcome?.status).toBe("queued");
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0]?.[1]).toMatchObject({ from: "2026-01-01", to: "2026-02-28" });
});

it("a committed A→B→A resets the draft and refuses the old A submit", async () => {
  const { h, post } = await setup(false);
  await fill(h);
  const oldSubmit = h.result.current.submit;
  const oldSet = h.result.current.setFrom;
  act(() => switchTo("B"));
  await flush();
  act(() => switchTo("A"));
  await flush();
  expect(h.result.current.draft.report).toBeNull();
  act(() => oldSet("2026-03-01"));
  expect(h.result.current.draft.from).toBe("");
  let outcome: Awaited<ReturnType<typeof oldSubmit>> | undefined;
  await act(async () => {
    outcome = await oldSubmit();
  });
  expect(outcome?.status).toBe("stale");
  expect(post).not.toHaveBeenCalled();
});

it("correcting an invalid date clears its feedback without a POST", async () => {
  const { h, post } = await setup(false);
  act(() => {
    h.result.current.setReport("daily_takings");
    h.result.current.setFrom("2026-12-31");
    h.result.current.setTo("2026-01-01");
  });
  await flush();
  await act(async () => void (await h.result.current.submit()));
  expect(h.result.current.issues.some((i) => i.path === "to" || i.path === "from")).toBe(true);
  act(() => h.result.current.setTo("2027-01-31"));
  expect(h.result.current.issues.filter((i) => i.path === "to" || i.path === "from")).toEqual([]);
  expect(post).not.toHaveBeenCalled();
});
