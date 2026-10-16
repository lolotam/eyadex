import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { ClinicFinanceTotals } from "./clinic-finance-totals";

vi.mock("@/shared/api/api-provider", () => ({
  useApi: () => ({
    finance: { platformTotals: () => Promise.reject(new Error("network down")) },
  }),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: { kind: "platform_admin", clinicId: null, memberId: null } }),
}));

afterEach(cleanup);

// PR #78 review: a failed read showed «لا توجد فواتير بعد», as if the clinic had invoiced nothing.
describe("the platform's clinic totals", () => {
  it("says the totals could not load and offers a retry instead of an empty report", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <I18nProvider manageDocument={false}>
          <ClinicFinanceTotals clinicId="00000000-0000-7000-8000-000000000001" />
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("تعذّر تحميل الإجماليات")).toBeTruthy();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeTruthy();
    expect(screen.queryByText("لا توجد فواتير بعد")).toBeNull();
  });
});
