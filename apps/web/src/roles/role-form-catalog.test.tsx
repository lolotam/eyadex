import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleListItem } from "@eyadex/contracts/roles";
import { ApiError } from "@/shared/api/api-error";
import { api, as, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
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
const realCatalog = (...args: Parameters<typeof api.roles.catalog>) => api.roles.catalog(...args);
const sorted = (keys: readonly string[]) => [...keys].sort();
const sentKeys = (): string[] => update.mock.calls[0]?.[2].permissionKeys ?? [];

beforeEach(() => {
  resetMockData();
  catalog.mockReset();
  update.mockReset();
  update.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

/** The receptionist: it holds finance keys, so a catalogue without finance leaves some unshown. */
async function receptionist(): Promise<RoleListItem> {
  const role = (await api.roles.list(persona)).find((r) => r.systemKey === "receptionist");
  if (!role) throw new Error("no receptionist role");
  return role;
}

async function openEditor(role: RoleListItem) {
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
const submitForm = () => fireEvent.submit(document.getElementById("role-form")!);
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

// Codex and MergePilot on PR #98: with no catalogue the matrix never rendered, so nothing is saved.
describe("the role form while the permission catalogue is missing", () => {
  it("NEGATIVE: keeps Save disabled while the catalogue loads, and sends nothing", async () => {
    catalog.mockImplementation(never);
    await openEditor(await receptionist());
    await waitFor(() => expect(catalog).toHaveBeenCalled());
    expect(saveButton()).toHaveProperty("disabled", true);
    submitForm();
    await settle();
    expect(update).not.toHaveBeenCalled();
  });

  it("NEGATIVE: keeps Save disabled when the catalogue fails, offers a retry, sends nothing", async () => {
    catalog.mockImplementation(down);
    await openEditor(await receptionist());
    expect(await screen.findByText(ar.roles.catalogLoadError)).toBeTruthy();
    expect(saveButton()).toHaveProperty("disabled", true);
    submitForm();
    await settle();
    expect(update).not.toHaveBeenCalled();
  });

  it("after a good load, a failed refresh keeps the matrix and Save, and offers a retry", async () => {
    catalog.mockImplementation(realCatalog);
    const role = await receptionist();
    const client = await openEditor(role);
    await waitFor(() => expect(saveButton()).toHaveProperty("disabled", false));
    catalog.mockImplementation(down);
    await client.refetchQueries();
    expect(await screen.findByText(ar.roles.catalogRefreshError)).toBeTruthy();
    expect(screen.getByRole("button", { name: ar.common.tryAgain })).toBeTruthy();
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
    fireEvent.click(saveButton());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sorted(sentKeys())).toEqual(sorted(role.permissionKeys));
  });
});

// MergePilot on PR #98: the payload is never filtered by the catalogue, so a stale one drops nothing.
describe("the keys the role form sends", () => {
  it("sends the visible edits plus every stored key the catalogue does not show", async () => {
    const stale = async (...args: Parameters<typeof api.roles.catalog>) =>
      (await api.roles.catalog(...args)).filter((d) => d.module !== "finance");
    catalog.mockImplementation(stale);
    update.mockImplementation((...args: Parameters<typeof api.roles.update>) =>
      api.roles.update(...args),
    );
    const role = await receptionist();
    const hidden = role.permissionKeys.filter((k) => /:(invoices|prices|payments|cash_)/.test(k));
    expect(hidden.length).toBeGreaterThan(0);
    await openEditor(role);
    const branches = `${ar.roles.actions.view} — ${ar.roles.resources.branches}`;
    fireEvent.click(await screen.findByRole("checkbox", { name: branches }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const expected = [...role.permissionKeys, "view:branches:clinic"];
    expect(sorted(sentKeys())).toEqual(sorted(expected));
    await waitFor(() =>
      expect(sorted(getState().roles.find((r) => r.id === role.id)?.permissions ?? [])).toEqual(
        sorted(expected),
      ),
    );
  });
});
