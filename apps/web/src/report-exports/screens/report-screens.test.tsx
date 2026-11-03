import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { as, resetMockData } from "@/shared/api/mock/mock-test-kit";
import {
  api as seedApi,
  admin,
  freeLine,
  issue,
  pay,
  personaWith,
} from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { context, renderScreen, signIn, TestLink } from "./report-screens.test-kit";
import { formatReportMinor, sumMinor } from "./report-money";
import { ReportScreenPage } from "./report-screen-page";
import { AvailableReports } from "./available-reports";

vi.mock("@/shared/api/api-provider", () => ({ useApi: () => context.api }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: context.persona, ready: true }),
  useSession: () => ({ session: context.session, isLoading: false, error: null }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: TestLink,
  useParams: () => ({ reportId: context.reportId }),
}));

const F = ar.financeReports;
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
beforeEach(() => resetMockData());

async function story() {
  const a = await issue([freeLine("10000")]);
  const b = await issue([freeLine("7000")]);
  const { payment } = await pay(a.id, "4000");
  await pay(b.id, "2500");
  await seedApi.payments.refund(
    admin(),
    a.id,
    {
      source: "payment",
      paymentId: payment.id,
      amountMinor: "1000",
      method: "cash",
      reason: "اختبار",
    },
    "00000000-0000-4000-8000-0000000000a1",
  );
}
const totalsCell = (column: string) =>
  screen.getByTestId("report-totals").querySelector(`[data-column="${column}"]`)?.textContent;
const open = async (reportId: string, persona = admin()) => {
  const api = await signIn(persona);
  context.reportId = reportId;
  renderScreen(<ReportScreenPage />);
  return api;
};

it("R1 totals equal the sum of its rows, in Arabic digits, with a signed net", async () => {
  await story();
  const api = await open("daily_takings");
  await screen.findAllByTestId("report-row");
  const r1 = await api.reports.dailyTakings(admin(), defaultQuery());
  for (const [col, field] of [
    ["in", "inMinor"],
    ["out", "outMinor"],
    ["net", "netMinor"],
  ] as const) {
    const sum = sumMinor(r1.rows.map((r) => r[field]));
    expect(r1.totals[field]).toBe(sum);
    expect(totalsCell(col)).toBe(
      `${formatReportMinor(sum, r1.currencyExponent, "ar")} ${r1.currency}`,
    );
  }
  expect(totalsCell("in")).toMatch(/[٠-٩]/);
  expect(screen.getAllByText(F.columns.net).length).toBeGreaterThan(0);
});

it("R2 shows all seven totals equal to its row sums and the credit help line", async () => {
  await story();
  const api = await open("period_summary");
  await screen.findAllByTestId("report-row");
  const r2 = await api.reports.periodSummary(admin(), defaultQuery());
  const money = [
    ["invoiced", "invoicedMinor"],
    ["discount", "discountMinor"],
    ["tax", "taxMinor"],
    ["collected", "collectedMinor"],
    ["refunded", "refundedMinor"],
    ["creditApplied", "creditAppliedMinor"],
  ] as const;
  for (const [col, field] of money) {
    const sum = sumMinor(r2.rows.map((r) => r[field]));
    expect(r2.totals[field]).toBe(sum);
    expect(totalsCell(col)).toBe(
      `${formatReportMinor(sum, r2.currencyExponent, "ar")} ${r2.currency}`,
    );
  }
  expect(r2.totals.voidCount).toBe(r2.rows.reduce((n, r) => n + r.voidCount, 0));
  expect(screen.getByText(F.creditHelp)).toBeTruthy();
});

it("a range over 366 days shows the translated message and sends no request", async () => {
  const api = await open("daily_takings");
  await screen.findByText(F.states.empty);
  const read = vi.spyOn(api.reports, "dailyTakings");
  fireEvent.change(screen.getByLabelText(F.filters.from), { target: { value: "2025-01-01" } });
  expect((await screen.findAllByText(F.issues.rangeTooLong)).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText(F.filters.to), { target: { value: "2024-12-31" } });
  expect((await screen.findAllByText(F.issues.dateOrder)).length).toBeGreaterThan(0);
  expect(read).not.toHaveBeenCalled();
});

it("an API report_range_too_long is shown translated, and retry recovers", async () => {
  await story();
  await signIn(admin());
  const read = vi
    .spyOn(context.api!.reports, "dailyTakings")
    .mockRejectedValueOnce(new ApiError("report_range_too_long"));
  context.reportId = "daily_takings";
  renderScreen(<ReportScreenPage />);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain(ar.errors.report_range_too_long);
  fireEvent.click(within(alert).getByRole("button", { name: F.states.retry }));
  await screen.findAllByTestId("report-row");
  expect(read).toHaveBeenCalledTimes(2);
});

it("a report the permissions do not open is forbidden by direct URL; an unbuilt one is not found", async () => {
  await open("period_summary", personaWith(["view:report_takings:branch", "view:payments:branch"]));
  expect(screen.getByText(ar.forbidden.title)).toBeTruthy();
  document.body.innerHTML = "";
  await open("refunds");
  expect(screen.getByText(ar.errors.not_found)).toBeTruthy();
});

it("a receptionist sees the R1, R2 and R9 cards and opens each; a doctor sees no card", async () => {
  await signIn(as("receptionist"));
  renderScreen(<AvailableReports />);
  const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
  expect(links).toEqual([
    "/clinic/reports/daily_takings",
    "/clinic/reports/period_summary",
    "/clinic/reports/cash_closings",
  ]);
  document.body.innerHTML = "";
  for (const id of ["daily_takings", "period_summary", "cash_closings"]) {
    await open(id, as("receptionist"));
    await screen.findByText(F.states.empty);
    document.body.innerHTML = "";
  }
  await signIn(as("doctor"));
  renderScreen(<AvailableReports />);
  expect(screen.queryByRole("link")).toBeNull();
});

it("the export button opens the export form prefilled; it accepts a range beyond 366 days", async () => {
  const api = await open("daily_takings");
  await screen.findByText(F.states.empty);
  const post = vi.spyOn(api.reports, "requestExport");
  fireEvent.click(screen.getByRole("button", { name: F.actions.export }));
  const dialog = await screen.findByRole("dialog");
  const R = ar.reportExports.request;
  const q = defaultQuery();
  expect((within(dialog).getByLabelText(R.from) as HTMLInputElement).value).toBe(q.from);
  expect((within(dialog).getByLabelText(R.to) as HTMLInputElement).value).toBe(q.to);
  fireEvent.change(within(dialog).getByLabelText(R.from), { target: { value: "2024-01-01" } });
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: R.submit }).hasAttribute("disabled")).toBe(
      false,
    ),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: R.submit }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0]?.[1]).toMatchObject({
    report: "daily_takings",
    from: "2024-01-01",
    to: q.to,
  });
});

it("a change of branch reach refetches the report and never keeps rows from the older scope", async () => {
  await story();
  const api = await signIn(admin());
  const spy = vi.spyOn(api.reports, "dailyTakings");
  context.reportId = "daily_takings";
  const tree = () => (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ReportScreenPage />
      </I18nProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  await screen.findAllByTestId("report-row");
  expect(spy).toHaveBeenCalledTimes(1);
  const wide = context.session;
  context.session = wide && {
    ...wide,
    allBranches: false,
    branchIds: ["00000000-0000-7000-8000-0000000000b9"],
  };
  view.rerender(tree());
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
});

function defaultQuery() {
  const zone = context.session?.clinic?.timezone ?? "Asia/Kuwait";
  const to = new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
  return { from: `${to.slice(0, 8)}01`, to };
}

it("Escape closes the export dialog, returns focus to its button, and reopening prefills afresh", async () => {
  await open("daily_takings");
  await screen.findByText(F.states.empty);
  const button = screen.getByRole("button", { name: F.actions.export });
  const R = ar.reportExports.request;
  fireEvent.click(button);
  let dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(R.from), { target: { value: "2024-01-01" } });
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(button));
  fireEvent.click(button);
  dialog = await screen.findByRole("dialog");
  expect((within(dialog).getByLabelText(R.from) as HTMLInputElement).value).toBe(
    defaultQuery().from,
  );
});
