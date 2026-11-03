import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { context, renderScreen, signIn, TestLink } from "./report-screens.test-kit";
import { formatReportMinor, sumMinor } from "./report-money";
import { ReportScreenPage } from "./report-screen-page";
import { BIG_ROWS, BIG_SUM, ownAnswer, R10_KEYS } from "./own-summary-report.fixtures";
import { lang, LangHandle } from "./own-summary-lang.test-kit";

vi.mock("@/shared/api/api-provider", () => ({ useApi: () => context.api }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: context.persona, ready: true }),
  useSession: () => ({ session: context.session, isLoading: false, error: null }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: TestLink,
  useParams: () => ({ reportId: context.reportId }),
}));

const O = ar.financeReports.ownSummary;
beforeEach(() => {
  resetMockData();
  localStorage.clear();
  context.reportId = "own_summary";
});

async function open(answer = ownAnswer(BIG_ROWS, BIG_SUM), keys = R10_KEYS) {
  const api = await signIn(personaWith(keys));
  const spy = vi.spyOn(api.reports, "ownSummary").mockResolvedValue(answer);
  const branchList = vi.spyOn(api.reports, "branchOptions");
  renderScreen(
    <LangHandle>
      <ReportScreenPage />
    </LangHandle>,
  );
  await screen.findAllByTestId("report-row");
  return { api, spy, branchList };
}
const totalsCell = () =>
  within(screen.getByTestId("report-totals")).getAllByRole("cell")[1]!.textContent;

it("the totals row is the response total, equal to the BigInt sum above 2^53", async () => {
  await open();
  expect(sumMinor(BIG_ROWS.map((r) => r.billedMinor))).toBe(BIG_SUM);
  expect(totalsCell()).toBe(`${formatReportMinor(BIG_SUM, 3, "ar")} KWD`);
});

it("a response total that disagrees with its rows is never shown", async () => {
  await open(ownAnswer(BIG_ROWS, "18014398509481984"));
  expect(totalsCell()).toBe(O.noValue);
  expect(document.body.textContent).not.toContain(formatReportMinor("18014398509481984", 3, "ar"));
});

it("months are formatted in Arabic and English, never as raw YYYY-MM", async () => {
  await open();
  const ar9 = new Intl.DateTimeFormat("ar-KW", { year: "numeric", month: "long", timeZone: "UTC" });
  expect(screen.getAllByText(ar9.format(new Date("2026-09-01T00:00:00Z"))).length).toBeGreaterThan(
    0,
  );
  expect(document.body.textContent).not.toMatch(/2026-0?9|2026-10/);
  act(() => lang.set("en"));
  expect(screen.getAllByText("September 2026").length).toBeGreaterThan(0);
  expect(screen.getAllByText("October 2026").length).toBeGreaterThan(0);
  expect(screen.getByText(en.financeReports.ownSummary.note)).toBeTruthy();
});

it("shows only month and billed: no paid, owed, branch or patient text, and no ids", async () => {
  await open();
  const text = document.body.textContent ?? "";
  const F = ar.financeReports;
  for (const banned of [F.filters.branch, F.patientCredit.columns.patient, "المدفوع", "المريض"])
    expect(text).not.toContain(banned);
  expect(text).toContain(O.month);
  expect(text).toContain(O.billed);
  expect(document.body.innerHTML).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-7/);
  const headers = within(screen.getByTestId("report-table"))
    .getAllByRole("columnheader")
    .map((h) => h.textContent);
  expect(headers).toEqual([O.month, O.billed]);
});

it("the header shows the own note, not the takings note", async () => {
  await open();
  expect(screen.getByText(O.note)).toBeTruthy();
  expect(screen.queryByText(ar.financeReports.note)).toBeNull();
});

it("«فواتيري» links to the invoices list only with the invoices permission", async () => {
  await open();
  expect(screen.getByRole("link", { name: O.myInvoices }).getAttribute("href")).toBe(
    "/clinic/invoices",
  );
  document.body.innerHTML = "";
  context.session = { ...context.session!, permissions: ["view:report_own:own"] };
  // Without the covering key the screen itself is forbidden, so no link can appear.
  renderScreen(<ReportScreenPage />);
  expect(screen.queryByRole("link", { name: O.myInvoices })).toBeNull();
});

it("has no branch picker, fetches no branch list and never sends branchId", async () => {
  const { spy, branchList } = await open();
  expect(screen.queryByLabelText(ar.financeReports.filters.branch)).toBeNull();
  fireEvent.change(screen.getByLabelText(ar.financeReports.filters.from), {
    target: { value: "2026-09-02" },
  });
  await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(1));
  for (const call of spy.mock.calls) expect(Object.keys(call[1]).sort()).toEqual(["from", "to"]);
  expect(branchList).not.toHaveBeenCalled();
});

it("empty uses the normal period wording; an error retries", async () => {
  const api = await signIn(personaWith(R10_KEYS));
  const spy = vi
    .spyOn(api.reports, "ownSummary")
    .mockRejectedValueOnce(new ApiError("unknown"))
    .mockResolvedValueOnce(ownAnswer([], "0"));
  renderScreen(<ReportScreenPage />);
  const alert = await screen.findByRole("alert");
  fireEvent.click(within(alert).getByRole("button", { name: ar.financeReports.states.retry }));
  expect(await screen.findByText(ar.financeReports.states.empty)).toBeTruthy();
  expect(spy).toHaveBeenCalledTimes(2);
});

it("a late answer for an old filter is never shown", async () => {
  const api = await signIn(personaWith(R10_KEYS));
  let resolveOld: (v: ReturnType<typeof ownAnswer>) => void = () => undefined;
  vi.spyOn(api.reports, "ownSummary")
    .mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
    .mockResolvedValue(ownAnswer([BIG_ROWS[1]!], BIG_ROWS[1]!.billedMinor));
  renderScreen(
    <LangHandle>
      <ReportScreenPage />
    </LangHandle>,
  );
  await waitFor(() => expect(screen.getByLabelText(ar.financeReports.filters.from)).toBeTruthy());
  fireEvent.change(screen.getByLabelText(ar.financeReports.filters.from), {
    target: { value: "2026-10-02" },
  });
  await screen.findAllByTestId("report-row");
  act(() => lang.set("en"));
  await act(async () => resolveOld(ownAnswer([BIG_ROWS[0]!], BIG_ROWS[0]!.billedMinor)));
  expect(screen.queryAllByText("September 2026")).toHaveLength(0);
  expect(screen.getAllByText("October 2026").length).toBeGreaterThan(0);
});
