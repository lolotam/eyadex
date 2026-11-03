import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import * as kit from "./export-request-form.test-kit";
import { NativeSelect } from "./export-native-select.test-kit";

vi.mock("@/shared/api/api-provider", () => ({ useApi: () => kit.context.api }));
vi.mock("@/shared/persona/persona-provider", () => ({
  usePersona: () => ({ persona: kit.context.persona, ready: true }),
  useSession: () => ({ session: kit.context.session, isLoading: false, error: null }),
}));
vi.mock("./export-select-field", () => ({
  ExportSelectField: (p: Parameters<typeof NativeSelect>[0]) => NativeSelect(p),
}));

const { R, setup, flush, pickIn, submit } = kit;
kit.useFormTestClock();

it("R10 exports with its period only: no branch field or list, a failing list cannot block it", async () => {
  const { post, api } = await setup(["view:report_own:own", "view:invoices:own"]);
  const branchList = vi.spyOn(api.reports, "branchOptions").mockRejectedValue(new TypeError("x"));
  pickIn(R.report, "own_summary");
  await flush();
  expect(screen.queryByLabelText(R.branch)).toBeNull();
  expect(screen.queryByText(R.branchesError)).toBeNull();
  expect(screen.queryByText(R.creditNote)).toBeNull();
  kit.typeIn(R.from, "2026-01-01");
  kit.typeIn(R.to, "2026-01-31");
  await submit();
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0]![1]).toMatchObject({
    report: "own_summary",
    from: "2026-01-01",
    to: "2026-01-31",
  });
  expect(post.mock.calls[0]![1]).not.toHaveProperty("branchId");
  expect(branchList.mock.calls.filter((c) => c[1] === "own_summary")).toHaveLength(0);
});
