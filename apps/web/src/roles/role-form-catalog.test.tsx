import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { api, as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PersonaContext } from "@/shared/persona/persona-context";
import { RoleFormDialog } from "./role-form-dialog";

// The real mock client, with the catalogue read and the role update under the test's control.
const { catalog, update } = vi.hoisted(() => ({ catalog: vi.fn(), update: vi.fn() }));
vi.mock("@/shared/api/api-provider", async () => {
  const { createMockApiClient } = await import("@/shared/api/mock/mock-adapter");
  const client = createMockApiClient();
  const recorded = { ...client, roles: { ...client.roles, catalog, update } };
  return {
    ApiProvider: ({ children }: { children: ReactNode }) => children,
    useApi: () => recorded,
  };
});

const persona = as("clinic_admin");
const never = () => new Promise<never>(() => undefined);
const down = () => Promise.reject(new ApiError("not_implemented"));

beforeEach(() => {
  resetMockData();
  catalog.mockReset();
  update.mockReset();
  update.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

async function openEditor() {
  const role = (await api.roles.list(persona)).find((r) => !r.isLocked && r.permissionKeys.length);
  if (!role) throw new Error("no editable role");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <PersonaContext.Provider value={{ persona, ready: true, setPersona: () => undefined }}>
          <RoleFormDialog open role={role} readOnly={false} onOpenChange={vi.fn()} />
        </PersonaContext.Provider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return client;
}

const saveButton = () => screen.getByRole("button", { name: ar.common.save });

// Codex and MergePilot on PR #98: the form sends the keys the catalogue shows, so with no catalogue it
// would send an empty set and clear every visible key of the role.
describe("the role form while the permission catalogue is missing", () => {
  it("NEGATIVE: keeps Save disabled while the catalogue loads, and sends nothing", async () => {
    catalog.mockImplementation(never);
    await openEditor();
    await waitFor(() => expect(catalog).toHaveBeenCalled());
    expect(saveButton()).toHaveProperty("disabled", true);
    fireEvent.submit(document.getElementById("role-form")!);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(update).not.toHaveBeenCalled();
  });

  it("NEGATIVE: keeps Save disabled when the catalogue fails, offers a retry, sends nothing", async () => {
    catalog.mockImplementation(down);
    await openEditor();
    expect(await screen.findByText(ar.roles.catalogLoadError)).toBeTruthy();
    expect(saveButton()).toHaveProperty("disabled", true);
    fireEvent.submit(document.getElementById("role-form")!);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(update).not.toHaveBeenCalled();
  });

  it("enables Save once the catalogue loads, and sends the role's shown keys", async () => {
    catalog.mockImplementation((...args: Parameters<typeof api.roles.catalog>) =>
      api.roles.catalog(...args),
    );
    await openEditor();
    await waitFor(() => expect(saveButton()).toHaveProperty("disabled", false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[2].permissionKeys.length).toBeGreaterThan(0);
  });

  // MergePilot on PR #98: a failed refresh keeps the cached catalogue, which is still safe to filter by.
  it("after a good load, a failed refresh keeps the matrix and Save, and offers a retry", async () => {
    catalog.mockImplementation((...args: Parameters<typeof api.roles.catalog>) =>
      api.roles.catalog(...args),
    );
    const client = await openEditor();
    await waitFor(() => expect(saveButton()).toHaveProperty("disabled", false));
    catalog.mockImplementation(down);
    await client.refetchQueries();
    expect(await screen.findByText(ar.roles.catalogRefreshError)).toBeTruthy();
    expect(screen.getByRole("button", { name: ar.common.tryAgain })).toBeTruthy();
    expect(screen.getByText(ar.roles.matrixTitle)).toBeTruthy();
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
    expect(saveButton()).toHaveProperty("disabled", false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[2].permissionKeys.length).toBeGreaterThan(0);
  });
});
