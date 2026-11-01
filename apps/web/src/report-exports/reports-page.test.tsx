import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { getState } from "@/shared/api/mock/mock-report-test-kit";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { CLINIC_NAV, navItemsFor } from "@/shared/shell/nav-items";
import { pageHeadText } from "@/shared/seo/page-head";
import * as kit from "./export-request-form.test-kit";
import { ReportsPage } from "./reports-page";

vi.mock("@/shared/api/api-provider", () => ({ useApi: () => kit.context.api }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: kit.context.persona, ready: true }),
  useSession: () => ({ session: kit.context.session, isLoading: false, error: null }),
}));
vi.mock("./export-select-field", () => ({
  ExportSelectField: (p: Parameters<typeof kit.NativeSelect>[0]) => kit.NativeSelect(p),
}));
const { R, TAKINGS, setup, flush, pickIn, typeIn, submit, sessionOf, context } = kit;
kit.useFormTestClock();

const H = ar.reportExports;
const paths = (keys: string[], features?: { finance: boolean }) =>
  navItemsFor(CLINIC_NAV, keys, features as never).map((i) => i.to);

function renderPage() {
  const list = vi.spyOn(context.api!.reports, "listExports");
  const view = render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider>
        <ReportsPage />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { list, view };
}

it("the Reports entry follows the finance module only, never report keys, and fails closed", () => {
  expect(paths([], { finance: true })).toContain("/clinic/reports");
  expect(paths(TAKINGS, { finance: true })).toContain("/clinic/reports");
  expect(paths(TAKINGS, { finance: false })).not.toContain("/clinic/reports");
  expect(paths(TAKINGS)).not.toContain("/clinic/reports");
  // Existing two-argument callers keep every other entry exactly as before.
  const others = (keys: string[]) => paths(keys).filter((p) => p !== "/clinic/reports");
  expect(paths(["view:cash_closings:branch"])).toEqual(others(["view:cash_closings:branch"]));
  const order = CLINIC_NAV.map((i) => i.to);
  expect(order.indexOf("/clinic/reports")).toBe(order.indexOf("/clinic/cash-closings") + 1);
  expect(ar.nav.reports).toBe("التقارير");
  expect(en.nav.reports).toBe("Reports");
  expect(pageHeadText("clinicReports", "ar").title).toBe("التقارير · Eyadex");
  expect(pageHeadText("clinicReports", "en").title).toBe("Reports · Eyadex");
});

it("renders the heading, then the form, then the requester's own history", async () => {
  await setup(TAKINGS);
  document.body.innerHTML = "";
  renderPage();
  await flush();
  const h1 = screen.getByRole("heading", { level: 1, name: ar.routes.clinicReports.title });
  const form = screen.getByRole("heading", { level: 2, name: R.title });
  const history = screen.getByRole("heading", { level: 2, name: H.title });
  expect(h1.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(form.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText(ar.routes.clinicReports.description)).toBeTruthy();
});

it("keeps the own history after report keys are revoked, while the form refuses new requests", async () => {
  const { persona } = await setup(TAKINGS);
  document.body.innerHTML = "";
  const { list, view } = renderPage();
  await flush();
  pickIn(R.report, "daily_takings");
  typeIn(R.from, "2026-01-01");
  typeIn(R.to, "2026-01-31");
  await flush();
  await submit();
  await flush();
  expect(screen.getAllByText(H.reports.daily_takings).length).toBeGreaterThan(0);
  const member = getState().members.find((m) => m.id === persona.memberId)!;
  getState().roles.find((r) => r.id === member.roleId)!.permissions = [];
  context.session = await sessionOf(context.api!, persona);
  expect(context.session.permissions).toEqual([]);
  const post = vi.spyOn(context.api!.reports, "requestExport");
  const before = post.mock.calls.length;
  view.unmount();
  list.mockRestore();
  renderPage();
  await flush();
  expect(screen.getByRole("heading", { level: 2, name: H.title })).toBeTruthy();
  expect(screen.getAllByText(H.reports.daily_takings).length).toBeGreaterThan(0);
  expect(screen.getByText(R.noReports)).toBeTruthy();
  await submit();
  expect(post.mock.calls.length).toBe(before);
});

it("finance off shows the module message and never calls the exports API", async () => {
  await setup(TAKINGS);
  document.body.innerHTML = "";
  context.session = {
    ...context.session!,
    features: { ...context.session!.features, finance: false },
  };
  const { list } = renderPage();
  await flush();
  expect(screen.getByText(ar.errors.module_disabled)).toBeTruthy();
  expect(screen.queryByRole("heading", { level: 2, name: H.title })).toBeNull();
  expect(list).not.toHaveBeenCalled();
});

it("an incoherent or blocked session mounts no export hooks", async () => {
  await setup(TAKINGS);
  document.body.innerHTML = "";
  const good = context.session!;
  for (const session of [
    { ...good, clinic: { ...good.clinic!, id: crypto.randomUUID() } },
    { ...good, membershipId: null },
    { ...good, blocked: "suspended" as const },
  ]) {
    context.session = session as typeof good;
    const { list, view } = renderPage();
    await flush();
    expect(screen.queryByRole("heading", { level: 2, name: H.title })).toBeNull();
    expect(list).not.toHaveBeenCalled();
    view.unmount();
    list.mockRestore();
  }
});
