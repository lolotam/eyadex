import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiProvider } from "@/shared/api/api-provider";
import { getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { PersonaProvider } from "@/shared/persona/persona-provider";
import { BookingProfileDialog } from "./booking-profile-dialog";

beforeEach(() => resetMockData());
afterEach(() => cleanup());

// Codex r1: a profile that could not be read must never be overwritten with the form's defaults.
describe("booking settings dialog", () => {
  it("NEGATIVE: when the profile cannot be loaded, it says so and save stays off", async () => {
    // The mock persona starts as the platform admin, so the read is refused.
    const member = getState().members[0]!;
    const user = { ...member, roleNameAr: "د", roleNameEn: "D" };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <ApiProvider>
            <PersonaProvider>
              <BookingProfileDialog user={user} onClose={() => undefined} />
            </PersonaProvider>
          </ApiProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(ar.bookingProfile.loadError)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ar.common.save })).toBeDisabled();
  });
});
