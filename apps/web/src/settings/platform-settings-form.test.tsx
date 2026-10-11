import { getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiProvider } from "@/shared/api/api-provider";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PersonaProvider } from "@/shared/persona/persona-provider";
import { PlatformSettingsForm } from "./platform-settings-form";

// The mock persona starts as the platform admin, so the form saves into the mock's settings.
function renderForm() {
  const settings = { ...getState().platformSettings };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider>
        <ApiProvider>
          <PersonaProvider>
            <PlatformSettingsForm settings={settings} />
          </PersonaProvider>
        </ApiProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => resetMockData());
afterEach(() => cleanup());

describe("platform settings page: new-clinic defaults (ADR-0020 amendment)", () => {
  it("shows the saved default limits and modules", () => {
    renderForm();
    const t = ar.platformSettings;
    expect(screen.getByLabelText(t.defaultMaxUsers)).toHaveValue(10);
    expect(screen.getByLabelText(t.defaultMaxBranches)).toHaveValue(3);
    expect(screen.getByRole("switch", { name: ar.clinics.modules.patients })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("saves changed defaults", async () => {
    renderForm();
    const t = ar.platformSettings;
    fireEvent.change(screen.getByLabelText(t.defaultMaxUsers), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText(t.defaultMaxBranches), { target: { value: "5" } });
    await act(async () =>
      screen.getByRole("switch", { name: ar.clinics.modules.patients }).click(),
    );
    await act(async () => screen.getByRole("button", { name: ar.common.save }).click());
    await waitFor(() =>
      expect(getState().platformSettings).toMatchObject({
        defaultMaxUsers: 25,
        defaultMaxBranches: 5,
        defaultModules: { patients: false, appointments: true, medical: true },
      }),
    );
  });

  it("NEGATIVE: an out-of-range default is not saved", async () => {
    renderForm();
    const field = screen.getByLabelText(ar.platformSettings.defaultMaxBranches);
    fireEvent.change(field, { target: { value: "101" } });
    await act(async () => screen.getByRole("button", { name: ar.common.save }).click());
    expect(await screen.findByText(ar.validation.outOfRange)).toBeInTheDocument();
    expect(getState().platformSettings.defaultMaxBranches).toBe(3);
  });
});
