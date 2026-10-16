import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ClinicLogoCard } from "./clinic-logo-card";

const logo = new Blob(["png"], { type: "image/png" });
vi.mock("@/shared/api/api-provider", () => ({ useApi: () => ({ finance: {} }) }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "clinic_admin", clinicId: "c", memberId: null } }),
}));
vi.mock("./finance-queries", () => ({
  useClinicLogo: () => ({ data: logo }),
  useRefreshFinanceSettings: () => () => undefined,
}));

afterEach(cleanup);

// PR #78 review: the logo's object URL was made in the query and never revoked, so every refetch pinned
// another copy of the file until the tab closed.
describe("the clinic logo card", () => {
  it("shows the logo through an object URL and revokes it when the card goes away", () => {
    const made = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:logo");
    const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const view = render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider manageDocument={false}>
          <ClinicLogoCard hasLogo editable={false} />
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("img").getAttribute("src")).toBe("blob:logo");
    expect(made).toHaveBeenCalledWith(logo);
    view.unmount();
    expect(revoked).toHaveBeenCalledWith("blob:logo");
    made.mockRestore();
    revoked.mockRestore();
  });
});
