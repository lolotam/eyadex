import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ClinicSettingsGuard } from "./clinic-settings-guard";
import { ClinicSettingsPage } from "./clinic-settings-page";

const state = vi.hoisted(() => ({
  features: {} as { finance?: boolean },
  navigate: vi.fn((_props: { to: string; replace: boolean }) => null),
}));
vi.mock("@tanstack/react-router", () => ({ Navigate: state.navigate, Link: "a" }));
vi.mock("@/shared/persona/persona-provider", () => ({
  useSession: () => ({
    session: { permissions: ["view:prices:clinic"], features: state.features },
    isLoading: false,
  }),
  usePersona: () => ({ persona: { kind: "clinic_admin" } }),
}));
vi.mock("./clinic-settings-content", () => ({ ClinicSettingsContent: () => null }));
vi.mock("./clinic-settings-shell", () => ({ ClinicSettingsShell: () => null }));

beforeEach(() => state.navigate.mockClear());
afterEach(cleanup);

describe.each(["landing", "guard"])("prices-only settings %s", (entry) => {
  function show() {
    render(
      <I18nProvider manageDocument={false}>
        {entry === "landing" ? (
          <ClinicSettingsPage />
        ) : (
          <ClinicSettingsGuard active="general">{null}</ClinicSettingsGuard>
        )}
      </I18nProvider>,
    );
  }

  it.each([{ finance: false }, {}])("refuses access without finance: %j", (features) => {
    state.features = features;
    show();
    expect(screen.getByText("غير مسموح")).toBeTruthy();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("redirects to services when finance is enabled", () => {
    state.features = { finance: true };
    show();
    expect(state.navigate.mock.calls[0]?.[0]).toMatchObject({
      to: "/clinic/settings/services",
      replace: true,
    });
    expect(screen.queryByText("غير مسموح")).toBeNull();
  });
});
