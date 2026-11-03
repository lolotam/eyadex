import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { context, renderScreen, signIn, TestLink } from "./report-screens.test-kit";
import { SCREEN_REPORTS, type ScreenReportId } from "./report-catalogue";
import { ReportShell } from "./report-shell";

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

const F = ar.financeReports;
// The exact header note each screen showed before the lookup map, plus R10's own.
const EXPECTED: Record<ScreenReportId, string> = {
  daily_takings: F.note,
  period_summary: F.note,
  cash_closings: F.cashClosingsNote,
  by_service: F.byServiceNote,
  by_doctor: F.byDoctorNote,
  outstanding: F.outstanding.note,
  patient_credit: F.patientCredit.note,
  refunds: F.adjustments.refundsNote,
  discounts: F.adjustments.discountsNote,
  own_summary: F.ownSummary.note,
};

it.each([...SCREEN_REPORTS])("%s shows its own header note", async (report) => {
  await signIn(personaWith(["view:report_takings:clinic", "view:payments:clinic"]));
  renderScreen(
    <ReportShell
      report={report}
      filters={{ from: "2026-10-01", to: "2026-10-31", branchId: null, groupBy: "day" }}
      zone="Asia/Kuwait"
      issues={{}}
      onChange={() => undefined}
    >
      {null}
    </ReportShell>,
  );
  const subtitle = screen.getByRole("heading", { name: F.names[report] }).parentElement!;
  expect(subtitle.textContent).toContain(EXPECTED[report]);
  for (const [other, note] of Object.entries(EXPECTED))
    if (note !== EXPECTED[report]) expect(subtitle.textContent, other).not.toContain(note);
});
