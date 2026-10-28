import { act, fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { getState } from "@/shared/api/mock/mock-report-test-kit";
import { id } from "@/shared/api/mock/mock-report-export.test-kit";
import { ar } from "@/shared/i18n/ar";
import * as kit from "./export-request-form.test-kit";

vi.mock("@/shared/api/api-provider", async () => {
  const { context } = await import("./export-request-form.test-kit");
  return { useApi: () => context.api };
});
vi.mock("@/shared/persona/persona-provider", async () => {
  const { context } = await import("./export-request-form.test-kit");
  return {
    usePersona: () => ({ persona: context.persona, ready: true }),
    useSession: () => ({ session: context.session, isLoading: false, error: null }),
  };
});
vi.mock("./export-select-field", async () => ({
  ExportSelectField: (await import("./export-request-form.test-kit")).NativeSelect,
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

it("no report, failed branches or a reach-invalid branch never POST; retry recovers", async () => {
  const { post, api, persona } = await setup(TAKINGS, false, 2);
  await submit();
  expect(screen.getByText(R.fields.reportRequired)).toBeTruthy();
  const real = api.reports.branchOptions.bind(api.reports);
  let fail = true;
  vi.spyOn(api.reports, "branchOptions").mockImplementation(async (...a) => {
    if (fail) throw new TypeError("network");
    return real(...a);
  });
  pickIn(R.report, "daily_takings");
  type(R.from, "2026-01-01");
  type(R.to, "2026-01-31");
  await flush();
  expect(screen.getByText(R.branchesError)).toBeTruthy();
  fireEvent.submit(screen.getByRole("button", { name: R.submit }).closest("form")!);
  await flush();
  expect(screen.getByText(R.fields.branchNotReady)).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: ar.reportExports.retry }));
  await flush();
  const b = getState().branches.filter((x) => x.clinicId === persona.clinicId)[1]!;
  pickIn(R.branch, b.id);
  getState().members.find((m) => m.id === persona.memberId)!.branchIds = [
    getState().branches.filter((x) => x.clinicId === persona.clinicId)[0]!.id,
  ];
  context.session = await sessionOf(api, persona);
  act(() => bump());
  await flush();
  expect((screen.getByLabelText(R.branch) as HTMLSelectElement).value).toBe("__unavailable__");
  expect(screen.getAllByText(R.fields.branchUnavailable).length).toBeGreaterThan(0);
  await submit();
  expect(post).not.toHaveBeenCalled();
  pickIn(R.branch, "__all__");
  await submit();
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0]![1]).not.toHaveProperty("branchId");
});

it("a double click sends one POST and disables every control while pending", async () => {
  const { post, real } = await setup(TAKINGS);
  let release = () => undefined as void;
  post.mockImplementation(async (...a) => {
    await new Promise<void>((r) => (release = r));
    return real(...a);
  });
  pickIn(R.report, "daily_takings");
  type(R.from, "2026-01-01");
  type(R.to, "2026-01-31");
  await flush();
  const button = screen.getByRole("button", { name: R.submit });
  fireEvent.click(button);
  fireEvent.click(button);
  await act(async () => void (await Promise.resolve()));
  expect(post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: R.submitting })).toHaveProperty("disabled", true);
  expect(screen.getByLabelText(R.report)).toHaveProperty("disabled", true);
  expect(screen.queryByText(R.queued)).toBeNull();
  release();
  await flush();
  expect(screen.getByText(R.queued)).toBeTruthy();
});

it("losing the report key marks the form unavailable while own history stays", async () => {
  const { api, persona, post } = await setup(TAKINGS, true);
  pickIn(R.report, "daily_takings");
  type(R.from, "2026-01-01");
  type(R.to, "2026-01-31");
  await flush();
  await submit();
  const role = getState().roles.find(
    (r) => r.id === getState().members.find((m) => m.id === persona.memberId)!.roleId,
  )!;
  role.permissions = ["view:report_takings:branch"];
  context.session = await sessionOf(api, persona);
  act(() => bump());
  await flush();
  expect(screen.getAllByText(R.fields.reportUnavailable).length).toBeGreaterThan(0);
  expect((screen.getByLabelText(R.report) as HTMLSelectElement).value).toBe("daily_takings");
  await submit();
  expect(post).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText(ar.reportExports.reports.daily_takings).length).toBeGreaterThan(1);
  expect(screen.queryByText(ar.reportExports.empty)).toBeNull();
  noRawKeys();
});
