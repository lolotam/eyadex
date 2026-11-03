import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { context, renderScreen, signIn, TestLink } from "./report-screens.test-kit";
import { formatReportMinor, sumMinor } from "./report-money";
import { ReportScreenPage } from "./report-screen-page";
import { deferred } from "./outstanding-report.fixtures";
import {
  CREDIT_PATIENT_ID,
  creditPage,
  creditRow,
  R6_KEYS,
} from "./patient-credit-report.fixtures";
import type { PatientCreditPage } from "./use-patient-credit-pages";

vi.mock("@/shared/api/api-provider", () => ({ useApi: () => context.api }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: context.persona, ready: true }),
  useSession: () => ({ session: context.session, isLoading: false, error: null }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: TestLink,
  useParams: () => ({ reportId: context.reportId }),
}));

const O = ar.financeReports.outstanding;
const money = (m: string) => `${formatReportMinor(m, 3, "ar")} KWD`;
beforeEach(() => {
  resetMockData();
  context.reportId = "patient_credit";
});

const ALL = [
  creditRow(1, "9007199254740993"),
  creditRow(2, "9007199254740995"),
  creditRow(3, "1500"),
];

async function open(
  pages: PatientCreditPage[] | ((q: { cursor?: string | undefined }) => Promise<PatientCreditPage>),
) {
  const api = await signIn(personaWith(R6_KEYS));
  const spy = vi.spyOn(api.reports, "patientCredit");
  if (typeof pages === "function") spy.mockImplementation((_p, q) => pages(q));
  else for (const p of pages) spy.mockResolvedValueOnce(p);
  renderScreen(<ReportScreenPage />);
  return { api, spy };
}
const rows = () => within(screen.getByTestId("report-table")).queryAllByTestId("report-row");

it("shows the clinic-wide notice above the list and beside the export button", async () => {
  await open([creditPage(ALL, ALL, null)]);
  await waitFor(() => expect(rows()).toHaveLength(3));
  const notes = screen.getAllByRole("note");
  expect(notes.map((n) => n.textContent)).toEqual([
    ar.financeReports.patientCredit.notice,
    ar.financeReports.patientCredit.notice,
  ]);
  const inline = screen.getByTestId("clinic-wide-notice-inline");
  expect(
    within(inline.parentElement as HTMLElement).getByRole("button", { name: /تصدير|export/i }),
  ).toBeTruthy();
  const banner = screen.getByTestId("clinic-wide-notice-banner");
  expect(
    banner.compareDocumentPosition(screen.getByTestId("report-table")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("shows no branch picker and never sends branchId, while the dates stay editable", async () => {
  const { spy } = await open(async () => creditPage(ALL, ALL, null));
  await waitFor(() => expect(rows()).toHaveLength(3));
  expect(screen.queryByLabelText(ar.financeReports.filters.branch)).toBeNull();
  fireEvent.change(screen.getByLabelText(ar.financeReports.filters.from), {
    target: { value: "2026-10-02" },
  });
  await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(1));
  for (const call of spy.mock.calls) expect(call[1]).not.toHaveProperty("branchId");
});

it("load more appends exactly the next page, sends limit 50 and shows the total", async () => {
  const { spy } = await open([
    creditPage(ALL.slice(0, 2), ALL, "c2"),
    creditPage(ALL.slice(2), ALL, null),
  ]);
  await waitFor(() => expect(rows()).toHaveLength(2));
  expect(spy.mock.calls[0]?.[1]).toMatchObject({ limit: 50 });
  expect(spy.mock.calls[0]?.[1]).not.toHaveProperty("cursor");
  expect(screen.getByTestId("patient-credit-showing").textContent).toContain("٣");
  fireEvent.click(screen.getByRole("button", { name: O.loadMore }));
  await waitFor(() => expect(rows()).toHaveLength(3));
  expect(spy.mock.calls[1]?.[1]).toMatchObject({ limit: 50, cursor: "c2" });
  expect(rows().map((r) => r.textContent?.match(/Credit Person \d/)?.[0])).toEqual([
    "Credit Person 1",
    "Credit Person 2",
    "Credit Person 3",
  ]);
});

it("a filter change restarts at page 1 and a late page of the old filter is ignored", async () => {
  const late = deferred<PatientCreditPage>();
  let call = 0;
  await open(async () => {
    call += 1;
    if (call === 1) return creditPage([ALL[0]!], ALL, "c2");
    if (call === 2) return late.promise;
    return creditPage([ALL[2]!], [ALL[2]!], null);
  });
  await waitFor(() => expect(rows()).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: O.loadMore }));
  fireEvent.change(screen.getByLabelText(ar.financeReports.filters.from), {
    target: { value: "2026-10-02" },
  });
  await waitFor(() => expect(screen.getAllByText("Credit Person 3").length).toBeGreaterThan(0));
  await act(async () => late.resolve(creditPage([ALL[1]!], ALL, null)));
  expect(rows()).toHaveLength(1);
  expect(screen.queryByText("Credit Person 2")).toBeNull();
});

it("an error on load more keeps the earlier pages and retries only that page", async () => {
  const { spy } = await open([creditPage([ALL[0]!], ALL, "c2")]);
  spy
    .mockRejectedValueOnce(new ApiError("unknown"))
    .mockResolvedValueOnce(creditPage([ALL[1]!], ALL, null));
  await waitFor(() => expect(rows()).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: O.loadMore }));
  fireEvent.click(await screen.findByRole("button", { name: O.retryMore }));
  await waitFor(() => expect(rows()).toHaveLength(2));
  expect(spy.mock.calls.slice(1).map((c) => c[1].cursor)).toEqual(["c2", "c2"]);
});

it("the totals row appears only when every page is loaded and equals the BigInt row sum", async () => {
  await open([creditPage(ALL.slice(0, 2), ALL, "c2"), creditPage(ALL.slice(2), ALL, null)]);
  await waitFor(() => expect(rows()).toHaveLength(2));
  expect(screen.queryByTestId("report-totals")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: O.loadMore }));
  await waitFor(() => expect(rows()).toHaveLength(3));
  const sum = sumMinor(ALL.map((r) => r.balanceMinor));
  expect(sum).toBe("18014398509483488");
  const cell = screen.getByTestId("report-totals").querySelector('[data-column="balance"]');
  expect(cell?.textContent).toBe(money(sum));
});

it("renders only the name, as plain text: no patient id and no link anywhere", async () => {
  await open([creditPage(ALL, ALL, null)]);
  await waitFor(() => expect(rows()).toHaveLength(3));
  const html = document.body.innerHTML;
  for (let n = 1; n <= 3; n += 1) expect(html).not.toContain(CREDIT_PATIENT_ID(n));
  expect(screen.queryByRole("link", { name: "Credit Person 1" })).toBeNull();
});

it("empty and first-page error states, with a retry", async () => {
  const { spy } = await open([creditPage([], [], null)]);
  expect(await screen.findByText(ar.financeReports.states.empty)).toBeTruthy();
  expect(spy).toHaveBeenCalledTimes(1);
  document.body.innerHTML = "";
  const again = await open(async () => {
    throw new ApiError("unknown");
  });
  fireEvent.click(await screen.findByRole("button", { name: ar.financeReports.states.retry }));
  await waitFor(() => expect(again.spy).toHaveBeenCalledTimes(2));
});

it("R6 keeps the frame's current clinic month as its default dates", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T09:00:00Z"));
  try {
    const { spy } = await open([creditPage(ALL, ALL, null)]);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(spy.mock.calls[0]?.[1]).toMatchObject({ from: "2026-10-01", to: "2026-10-20" });
  } finally {
    vi.useRealTimers();
  }
});
