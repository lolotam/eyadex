import { getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PLATFORM_SETTINGS } from "@eyadex/contracts/platform";
import { ApiProvider } from "@/shared/api/api-provider";
import { PersonaProvider } from "@/shared/persona/persona-provider";
import { useNewClinicFormValues } from "./use-new-clinic-form-values";

// The mock persona starts as the platform admin (memberId null): the settings page's query key.
const KEY = ["platform", "settings", "platform_admin", null];

function setup(cached?: unknown) {
  const client = new QueryClient();
  if (cached) client.setQueryData(KEY, cached);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ApiProvider>
        <PersonaProvider>{children}</PersonaProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
  return { client, ...renderHook(() => useNewClinicFormValues(), { wrapper }) };
}

beforeEach(() => resetMockData());
afterEach(() => cleanup());

describe("the create form's first values (ADR-0020 amendment)", () => {
  it("NEGATIVE: a cached copy from before another admin's change is never used", async () => {
    getState().platformSettings = {
      ...DEFAULT_PLATFORM_SETTINGS,
      defaultMaxUsers: 25,
      defaultModules: { patients: false, appointments: false, medical: false },
    };
    const { result } = setup(DEFAULT_PLATFORM_SETTINGS);
    expect(result.current.values).toBeNull();
    await waitFor(() => expect(result.current.values).not.toBeNull());
    expect(result.current.values).toMatchObject({
      maxUsers: 25,
      modules: { patients: false, appointments: false, medical: false },
    });
  });

  it("keeps the values it took when the settings change later", async () => {
    const { result, client } = setup();
    await waitFor(() => expect(result.current.values).not.toBeNull());
    getState().platformSettings = { ...DEFAULT_PLATFORM_SETTINGS, defaultMaxBranches: 9 };
    await client.refetchQueries({ queryKey: KEY });
    expect(result.current.values).toMatchObject({ maxBranches: 3 });
  });
});
