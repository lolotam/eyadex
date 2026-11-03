import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { context, renderScreen, signIn, TestLink } from "./report-screens.test-kit";
import { availableScreens, canOpenReport, SCREEN_REPORTS } from "./report-catalogue";
import { ReportScreenPage } from "./report-screen-page";

vi.mock("@/shared/api/api-provider", () => ({ useApi: () => context.api }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: context.persona, ready: true }),
  useSession: () => ({ session: context.session, isLoading: false, error: null }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: TestLink,
  useParams: () => ({ reportId: context.reportId }),
}));

beforeEach(() => resetMockData());

const opens = (keys: string[]) => [canOpenReport(keys, "refunds"), canOpenReport(keys, "discounts")];

it("each covering key opens only its own report", () => {
  expect(opens(["view:report_patients:clinic", "view:payments:clinic"])).toEqual([true, false]);
  expect(opens(["view:report_patients:clinic", "view:invoices:clinic"])).toEqual([false, true]);
  expect(
    opens(["view:report_patients:branch", "view:payments:branch", "view:invoices:branch"]),
  ).toEqual([true, true]);
  expect(opens(["view:report_patients:clinic"])).toEqual([false, false]);
});

it("report_own, report_takings or report_analytics never open R7 or R8", () => {
  const covering = ["view:payments:clinic", "view:invoices:clinic"];
  for (const key of ["view:report_own:own", "view:report_takings:clinic", "view:report_analytics:clinic"])
    expect(opens([key, ...covering])).toEqual([false, false]);
});

it("cards show only for the reports the caller may open; R10 stays hidden", () => {
  expect(availableScreens(["view:report_patients:branch", "view:invoices:branch"])).toEqual([
    "outstanding",
    "discounts",
  ]);
  expect((SCREEN_REPORTS as readonly string[]).includes("own_summary")).toBe(false);
});

it("the routes are forbidden without the covering key", async () => {
  for (const report of ["refunds", "discounts"]) {
    document.body.innerHTML = "";
    context.reportId = report;
    await signIn(personaWith(["view:report_patients:clinic"]));
    renderScreen(<ReportScreenPage />);
    expect(screen.getByText(ar.forbidden.title)).toBeTruthy();
  }
});
