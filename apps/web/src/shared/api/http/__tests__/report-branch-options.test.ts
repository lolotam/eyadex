import { expect, it, vi } from "vitest";
import { createHttpApiClient } from "../http-adapter";
import type { ReportId } from "@eyadex/contracts/finance-reports";
import type { Persona } from "@eyadex/contracts/session";
import { CLINIC, USER, NOW, code } from "./fetch-stub";

const actor: Persona = { kind: "custom", clinicId: CLINIC, memberId: USER };
const branch = { id: USER, nameAr: "فرع تجريبي", nameEn: "Sample branch", isActive: false };
const page = { items: [branch], nextCursor: null, total: 1 };
const reports: ReportId[] = [
  "daily_takings",
  "period_summary",
  "by_service",
  "by_doctor",
  "outstanding",
  "patient_credit",
  "refunds",
  "discounts",
  "cash_closings",
  "own_summary",
];
function client(answer: unknown, status = 200) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(answer), { status }));
  return { api: createHttpApiClient(fetchImpl, () => NOW), fetchImpl };
}

it.each(reports)(
  "root reports.branchOptions sends %s to its exact static route with same-origin cookies",
  async (report) => {
    const h = client(page);
    expect(
      await h.api.reports.branchOptions(actor, report, { limit: 7, cursor: "opaque/cursor" }),
    ).toEqual(page);
    expect(h.fetchImpl).toHaveBeenCalledWith(
      `/api/v1/finance-reports/${report.replaceAll("_", "-")}/branch-options?limit=7&cursor=opaque%2Fcursor`,
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
  },
);

it("forwards input for server validation and rejects a malformed branch response", async () => {
  const h = client(page);
  await h.api.reports.branchOptions(actor, "by_service", { limit: 0 });
  expect(h.fetchImpl).toHaveBeenCalledWith(
    "/api/v1/finance-reports/by-service/branch-options?limit=0",
    expect.anything(),
  );
  const bad = client({ ...page, items: [{ ...branch, isActive: "false" }] });
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect((await code(bad.api.reports.branchOptions(actor, "by_service", {}))).code).toBe(
      "unknown",
    );
  } finally {
    spy.mockRestore();
  }
});

it.each(["forbidden", "module_disabled", "account_disabled", "subscription_blocked"])(
  "preserves %s without leaking server messages",
  async (error) => {
    const h = client({ code: error, message_ar: "رفض", message_en: "private-message" }, 403);
    const result = await h.api.reports
      .branchOptions(actor, "by_service", {})
      .catch((value: unknown) => value);
    expect(result).toMatchObject({ code: error });
    expect(String(result)).not.toContain("private-message");
  },
);
