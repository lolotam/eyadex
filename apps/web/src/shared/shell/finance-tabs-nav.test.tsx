import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { FinanceTabs } from "./finance-tabs";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/shared/persona/persona-provider", () => ({
  useSession: () => ({
    session: { permissions: ["view:invoices:clinic", "view:payments:clinic"] },
  }),
}));

afterEach(cleanup);

// Card 1b review: the strip is route navigation, so links with aria-current, not tabs.
describe("the finance strip", () => {
  it("is a nav of links, the active one marked aria-current, no tab roles", () => {
    render(
      <I18nProvider>
        <FinanceTabs active="payments" />
      </I18nProvider>,
    );
    expect(screen.getByRole("navigation", { name: ar.payments.tabs.label })).toBeInTheDocument();
    const payments = screen.getByRole("link", { name: ar.payments.tabs.payments });
    const invoices = screen.getByRole("link", { name: ar.payments.tabs.invoices });
    expect(payments).toHaveAttribute("aria-current", "page");
    expect(invoices).not.toHaveAttribute("aria-current");
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});
