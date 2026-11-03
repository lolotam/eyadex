import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { freeLine, issue, personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { context, renderScreen, signIn, TestLink } from "./report-screens.test-kit";
import { availableScreens, canOpenReport } from "./report-catalogue";
import { ReportScreenPage } from "./report-screen-page";
import { R5_KEYS } from "./outstanding-report.fixtures";

vi.mock("@/shared/api/api-provider", () => ({ useApi: () => context.api }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: context.persona, ready: true }),
  useSession: () => ({ session: context.session, isLoading: false, error: null }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: TestLink,
  useParams: () => ({ reportId: context.reportId }),
}));

beforeEach(() => {
  resetMockData();
  context.reportId = "outstanding";
});

it("report_patients with covering view:invoices opens R5; nothing less does", () => {
  expect(canOpenReport(R5_KEYS, "outstanding")).toBe(true);
  expect(
    canOpenReport(["view:report_patients:branch", "view:invoices:branch"], "outstanding"),
  ).toBe(true);
  expect(canOpenReport(["view:report_patients:clinic"], "outstanding")).toBe(false);
  expect(canOpenReport(["view:report_own:own", "view:invoices:clinic"], "outstanding")).toBe(false);
  expect(canOpenReport(["view:report_takings:clinic", "view:invoices:clinic"], "outstanding")).toBe(
    false,
  );
  // R6 (patient_credit) opens for this set (clinic report_patients + view:payments:clinic);
  // R7, R8 and R10 stay hidden even for a caller who could open them.
  expect(availableScreens([...R5_KEYS, "view:payments:clinic", "view:report_own:own"])).toEqual([
    "outstanding",
    "patient_credit",
  ]);
  expect(availableScreens(["view:report_patients:clinic"])).toEqual([]);
});

it("the /clinic/reports/outstanding route opens with real mock data", async () => {
  await issue([freeLine("10000")]);
  await signIn(personaWith(R5_KEYS));
  renderScreen(<ReportScreenPage />);
  expect(
    await screen.findByRole("heading", { name: ar.financeReports.names.outstanding }),
  ).toBeTruthy();
  expect((await screen.findAllByTestId("report-row")).length).toBeGreaterThan(0);
});

it("the route is forbidden without the covering view:invoices key", async () => {
  await signIn(personaWith(["view:report_patients:clinic"]));
  renderScreen(<ReportScreenPage />);
  expect(screen.getByText(ar.forbidden.title)).toBeTruthy();
});
