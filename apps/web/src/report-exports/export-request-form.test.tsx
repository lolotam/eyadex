import { act, fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { getState } from "@/shared/api/mock/mock-report-test-kit";
import { id } from "@/shared/api/mock/mock-report-export.test-kit";
import { ar } from "@/shared/i18n/ar";
import * as kit from "./export-request-form.test-kit";

// The closures read the kit only when a hook runs, after every import has resolved.
vi.mock("@/shared/api/api-provider", () => ({ useApi: () => kit.context.api }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: kit.context.persona, ready: true }),
  useSession: () => ({ session: kit.context.session, isLoading: false, error: null }),
}));
vi.mock("./export-select-field", () => ({
  ExportSelectField: (p: Parameters<typeof kit.NativeSelect>[0]) => kit.NativeSelect(p),
}));

const {
  R,
  E,
  TAKINGS,
  ANALYTICS,
  CREDIT,
  setup,
  flush,
  pickIn,
  submit,
  noRawKeys,
  sessionOf,
  context,
} = kit;
const type = kit.typeIn;
const setLang = (l: "ar" | "en") => kit.setLang(l);
const bump = () => kit.bump();
kit.useFormTestClock();

it("labels every field in Arabic and English with only the reports the actor may export", async () => {
  await setup([...TAKINGS, "view:report_analytics:clinic", "view:invoices:branch"]);
  const options = () =>
    [...(screen.getByLabelText(R.report) as HTMLSelectElement).options].map((o) => o.text);
  expect(options()).toEqual([
    R.reportPlaceholder,
    ar.reportExports.reports.daily_takings,
    ar.reportExports.reports.period_summary,
  ]);
  for (const label of [R.report, R.from, R.to, R.branch, R.format, R.language])
    expect(screen.getByLabelText(label)).toBeTruthy();
  expect(screen.queryByLabelText(R.groupBy)).toBeNull();
  pickIn(R.report, "daily_takings");
  await flush();
  expect((screen.getByLabelText(R.groupBy) as HTMLSelectElement).value).toBe("day");
  pickIn(R.report, "period_summary");
  expect((screen.getByLabelText(R.groupBy) as HTMLSelectElement).value).toBe("month");
  expect((screen.getByLabelText(R.language) as HTMLSelectElement).value).toBe("ar");
  act(() => setLang("en"));
  for (const label of [E.report, E.from, E.to, E.branch, E.format, E.language, E.groupBy])
    expect(screen.getByLabelText(label)).toBeTruthy();
  expect((screen.getByLabelText(E.language) as HTMLSelectElement).value).toBe("en");
  pickIn(E.language, "ar");
  act(() => setLang("ar"));
  act(() => setLang("en"));
  expect((screen.getByLabelText(E.language) as HTMLSelectElement).value).toBe("ar");
  noRawKeys();
});

it("lists real bilingual branch names, the inactive one marked, and all branches explicitly", async () => {
  await setup(ANALYTICS);
  pickIn(R.report, "by_service");
  await flush();
  const texts = (label: string) =>
    [...(screen.getByLabelText(label) as HTMLSelectElement).options].map((o) => o.text);
  expect(texts(R.branch)).toContain(R.allBranches);
  expect(texts(R.branch)).toContain("فرع أ");
  expect(texts(R.branch)).toContain(R.inactive.replace("{name}", "فرع قديم"));
  act(() => setLang("en"));
  expect(texts(E.branch)).toContain(E.inactive.replace("{name}", "Old branch"));
  expect(texts(E.branch)).toContain("Branch A");
  expect((screen.getByLabelText(E.branch) as HTMLSelectElement).value).toBe("__all__");
  noRawKeys();
});

it.each(["csv", "xlsx"] as const)(
  "queues the exact %s body and the row appears in own history",
  async (format) => {
    const { post, persona } = await setup(ANALYTICS, true);
    pickIn(R.report, "by_service");
    type(R.from, "2026-01-01");
    type(R.to, "2026-03-31");
    await flush();
    pickIn(R.branch, id(30000));
    pickIn(R.format, format);
    pickIn(R.language, "en");
    await submit();
    expect(post.mock.calls).toEqual([
      [
        persona,
        {
          report: "by_service",
          from: "2026-01-01",
          to: "2026-03-31",
          branchId: id(30000),
          format,
          language: "en",
        },
      ],
    ]);
    expect(screen.getByText(R.queued)).toBeTruthy();
    expect(screen.queryByText(ar.reportExports.empty)).toBeNull();
    expect(screen.getAllByText(ar.reportExports.reports.by_service).length).toBeGreaterThan(1);
    expect((screen.getByLabelText(R.from) as HTMLInputElement).value).toBe("2026-01-01");
    noRawKeys();
  },
);

it("R6 shows the clinic-wide balance note in both languages and still requires its dates", async () => {
  const { post } = await setup(CREDIT);
  expect(screen.queryByText(R.creditNote)).toBeNull();
  pickIn(R.report, "patient_credit");
  await flush();
  expect(screen.getByRole("note").textContent).toBe(R.creditNote);
  await submit();
  expect(post).not.toHaveBeenCalled();
  expect(screen.getByLabelText(R.from).getAttribute("aria-invalid")).toBe("true");
  expect(screen.getAllByText(R.issues.date).length).toBe(2);
  act(() => setLang("en"));
  expect(screen.getByRole("note").textContent).toBe(E.creditNote);
  type(E.from, "2026-02-01");
  type(E.to, "2026-01-01");
  await submit(E.submit);
  expect(screen.getByText(E.issues.dateOrder)).toBeTruthy();
  type(E.from, "2026-01-01");
  type(E.to, "2026-01-31");
  await submit(E.submit);
  expect(post.mock.calls[0]![1]).toMatchObject({
    report: "patient_credit",
    from: "2026-01-01",
    to: "2026-01-31",
  });
  noRawKeys();
});
