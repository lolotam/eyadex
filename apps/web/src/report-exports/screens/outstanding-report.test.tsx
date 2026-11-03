import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { resetMockData } from "@/shared/api/mock/mock-test-kit";
import { personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { context, renderScreen, signIn, TestLink } from "./report-screens.test-kit";
import { bucketTotals } from "./outstanding-summary";
import { formatReportMinor } from "./report-money";
import { ReportScreenPage } from "./report-screen-page";
import { BRANCH_B, deferred, page, PATIENT_ID, R5_KEYS, row } from "./outstanding-report.fixtures";
import type { OutstandingPage } from "./use-outstanding-pages";

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
  context.reportId = "outstanding";
});

const ALL = [
  row(1, "0_30", "1500"),
  row(2, "0_30", "9007199254740993"),
  row(3, "31_60", "2500", BRANCH_B),
  row(4, "over_90", "4000"),
];

async function open(
  pages: OutstandingPage[] | ((q: { cursor?: string | undefined }) => Promise<OutstandingPage>),
) {
  const api = await signIn(personaWith(R5_KEYS));
  const spy = vi.spyOn(api.reports, "outstanding");
  if (typeof pages === "function") spy.mockImplementation((_p, q) => pages(q));
  else for (const p of pages) spy.mockResolvedValueOnce(p);
  renderScreen(<ReportScreenPage />);
  return { api, spy };
}
const rows = () => within(screen.getByTestId("report-table")).queryAllByTestId("report-row");
const card = (bucket: string) =>
  document.querySelector(`[data-scope="all"] [data-bucket-card="${bucket}"]`) as HTMLElement;

it("cards equal the BigInt sums of the table rows and the response summary, per bucket", async () => {
  await open([page(ALL, ALL, null)]);
  await waitFor(() => expect(rows()).toHaveLength(4));
  const fromRows = bucketTotals(ALL);
  expect(fromRows.find((b) => b.bucket === "0_30")?.owedMinor).toBe("9007199254742493");
  for (const total of fromRows) {
    expect(card(total.bucket).querySelector("[data-owed]")?.textContent).toBe(
      money(total.owedMinor),
    );
  }
  // An empty bucket is shown with zero, not hidden.
  expect(card("61_90").querySelector("[data-owed]")?.textContent).toBe(money("0"));
  // Per-branch cards when no branch is chosen; names from the data, never invented.
  expect(document.querySelectorAll('[data-scope="branch"]')).toHaveLength(2);
  expect(screen.getAllByText("Branch B").length).toBeGreaterThan(0);
});

it("load more appends exactly the next page, sends limit 50 and shows the total", async () => {
  const { spy } = await open([page(ALL.slice(0, 2), ALL, "c2"), page(ALL.slice(2), ALL, null)]);
  await waitFor(() => expect(rows()).toHaveLength(2));
  expect(spy.mock.calls[0]?.[1]).toMatchObject({ limit: 50 });
  expect(spy.mock.calls[0]?.[1]).not.toHaveProperty("cursor");
  expect(screen.getByTestId("outstanding-showing").textContent).toContain("٤");
  fireEvent.click(screen.getByRole("button", { name: O.loadMore }));
  await waitFor(() => expect(rows()).toHaveLength(4));
  expect(spy.mock.calls[1]?.[1]).toMatchObject({ limit: 50, cursor: "c2" });
  expect(rows().map((r) => r.textContent?.match(/T-\d/)?.[0])).toEqual([
    "T-1",
    "T-2",
    "T-3",
    "T-4",
  ]);
  expect(screen.queryByRole("button", { name: O.loadMore })).toBeNull();
});

it("a filter change restarts at page 1 and a late page of the old filter is ignored", async () => {
  const late = deferred<OutstandingPage>();
  let call = 0;
  await open(async () => {
    call += 1;
    if (call === 1) return page([ALL[0]!], ALL, "c2");
    if (call === 2) return late.promise;
    return page([ALL[3]!], [ALL[3]!], null);
  });
  await waitFor(() => expect(rows()).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: O.loadMore }));
  fireEvent.change(screen.getByLabelText(ar.financeReports.filters.from), {
    target: { value: "2026-10-02" },
  });
  await waitFor(() => expect(screen.getAllByText("T-4").length).toBeGreaterThan(0));
  await act(async () => late.resolve(page([ALL[1]!], ALL, null)));
  expect(rows()).toHaveLength(1);
  expect(screen.queryByText("T-2")).toBeNull();
});

it("an error on load more keeps the earlier pages and retries only that page", async () => {
  const { spy } = await open([page([ALL[0]!], ALL, "c2")]);
  spy
    .mockRejectedValueOnce(new ApiError("unknown"))
    .mockResolvedValueOnce(page([ALL[1]!], ALL, null));
  await waitFor(() => expect(rows()).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: O.loadMore }));
  fireEvent.click(await screen.findByRole("button", { name: O.retryMore }));
  await waitFor(() => expect(rows()).toHaveLength(2));
  expect(spy.mock.calls.slice(1).map((c) => c[1].cursor)).toEqual(["c2", "c2"]);
});

it("renders only the patient's name: no patient id anywhere in the page", async () => {
  await open([page(ALL, ALL, null)]);
  await waitFor(() => expect(rows()).toHaveLength(4));
  expect(screen.getAllByText("Test Patient 1").length).toBeGreaterThan(0);
  const html = document.body.innerHTML;
  for (const r of ALL) expect(html).not.toContain(PATIENT_ID(Number(r.invoiceNumber.slice(2))));
  expect(screen.getAllByRole("link", { name: "T-1" })[0]?.getAttribute("href")).toContain(
    "/clinic/invoices/",
  );
});

it("empty and first-page error states, with a retry", async () => {
  const { spy } = await open([page([], [], null)]);
  expect(await screen.findByText(ar.financeReports.states.empty)).toBeTruthy();
  expect(spy).toHaveBeenCalledTimes(1);
  document.body.innerHTML = "";
  const again = await open(async () => {
    throw new ApiError("unknown");
  });
  fireEvent.click(await screen.findByRole("button", { name: ar.financeReports.states.retry }));
  await waitFor(() => expect(again.spy).toHaveBeenCalledTimes(2));
});
