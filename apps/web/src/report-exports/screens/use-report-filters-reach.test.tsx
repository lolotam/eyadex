import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/api-error";
import { clinicIdAt, getState, resetMockData } from "@/shared/api/mock/mock-test-kit";
import { personaWith } from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { NativeSelect } from "../export-native-select.test-kit";
import { context, signIn, TestLink } from "./report-screens.test-kit";
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
vi.mock("../export-select-field", () => ({ ExportSelectField: NativeSelect }));

const F = ar.financeReports;
beforeEach(() => resetMockData());

it("when reach narrows past the chosen branch, the selection resets to all and the report loads", async () => {
  const [first, second] = getState().branches.filter(
    (b) => b.clinicId === clinicIdAt(0) && b.isActive,
  );
  if (!first || !second) throw new Error("seed needs two active branches");
  const persona = personaWith(
    [
      "view:report_takings:branch",
      "view:payments:branch",
      "view:invoices:branch",
      "view:cash_closings:branch",
    ],
    [first.id, second.id],
  );
  const api = await signIn(persona);
  context.reportId = "cash_closings";
  const spy = vi.spyOn(api.reports, "cashClosings");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ReportScreenPage />
      </I18nProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  await screen.findByText(F.states.empty);
  const select = () => screen.getByLabelText(F.filters.branch) as HTMLSelectElement;
  await waitFor(() => expect(select().disabled).toBe(false));
  fireEvent.change(select(), { target: { value: second.id } });
  await waitFor(() => expect(spy.mock.calls.at(-1)?.[1]).toMatchObject({ branchId: second.id }));
  const before = spy.mock.calls.length;

  // The member loses the chosen branch while the screen stays open.
  const member = getState().members.find((m) => m.id === persona.memberId)!;
  member.branchIds = [first.id];
  context.session = await api.session.getContext(persona);
  view.rerender(tree());

  await waitFor(() => expect(select().value).toBe("__all__"));
  await screen.findByText(F.states.empty);
  const after = spy.mock.calls.slice(before).map((c) => c[1]);
  expect(after.length).toBeGreaterThan(0);
  for (const query of after) expect(query).not.toHaveProperty("branchId", second.id);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("when the branch list cannot be loaded, the report falls back to all branches and stays usable", async () => {
  const [first, second] = getState().branches.filter(
    (b) => b.clinicId === clinicIdAt(0) && b.isActive,
  );
  if (!first || !second) throw new Error("seed needs two active branches");
  const persona = personaWith(
    [
      "view:report_takings:branch",
      "view:payments:branch",
      "view:invoices:branch",
      "view:cash_closings:branch",
    ],
    [first.id, second.id],
  );
  const api = await signIn(persona);
  context.reportId = "cash_closings";
  const spy = vi.spyOn(api.reports, "cashClosings");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ReportScreenPage />
      </I18nProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  await screen.findByText(F.states.empty);
  const select = () => screen.getByLabelText(F.filters.branch) as HTMLSelectElement;
  await waitFor(() => expect(select().disabled).toBe(false));
  fireEvent.change(select(), { target: { value: second.id } });
  await waitFor(() => expect(spy.mock.calls.at(-1)?.[1]).toMatchObject({ branchId: second.id }));
  const before = spy.mock.calls.length;

  // The access changes and the branch list then fails to load (a transient error).
  vi.spyOn(api.reports, "branchOptions").mockRejectedValue(new ApiError("unknown"));
  const member = getState().members.find((m) => m.id === persona.memberId)!;
  member.branchIds = [first.id];
  context.session = await api.session.getContext(persona);
  view.rerender(tree());

  // The choice cannot be checked, so the report goes back to all branches instead of going blank,
  // the picker stays usable on "all", and the notice offers a retry.
  await screen.findByText(F.filters.branchesError);
  await waitFor(() => expect(select().value).toBe("__all__"));
  expect(select().disabled).toBe(false);
  await screen.findByText(F.states.empty);
  await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before));
  expect(spy.mock.calls.at(-1)?.[1]).not.toHaveProperty("branchId");
  expect(screen.getByRole("button", { name: F.states.retry })).toBeTruthy();
});
