import { describe, expect, it } from "vitest";

import { FINANCE_REPORT_EXPORT_REQUESTED, parseExportRequested } from "./export-event.ts";

const clinicId = "11111111-1111-4111-8111-111111111111";
const exportId = "22222222-2222-4222-8222-222222222222";

describe("parseExportRequested", () => {
  it("accepts the exact type, clinic context and exportId", () => {
    expect(
      parseExportRequested({
        type: FINANCE_REPORT_EXPORT_REQUESTED,
        clinicId,
        payload: { exportId },
      }),
    ).toEqual({ clinicId, exportId });
    expect(FINANCE_REPORT_EXPORT_REQUESTED).toBe("finance.report_export_requested");
  });

  it.each([
    { type: "finance.report_export_requested.extra", clinicId, payload: { exportId } },
    { type: FINANCE_REPORT_EXPORT_REQUESTED, clinicId: null, payload: { exportId } },
    { type: FINANCE_REPORT_EXPORT_REQUESTED, clinicId: "not-a-uuid", payload: { exportId } },
    { type: FINANCE_REPORT_EXPORT_REQUESTED, clinicId, payload: {} },
    { type: FINANCE_REPORT_EXPORT_REQUESTED, clinicId, payload: { exportId: "nope" } },
    { type: FINANCE_REPORT_EXPORT_REQUESTED, clinicId, payload: { exportId, clinicId } },
    { type: FINANCE_REPORT_EXPORT_REQUESTED, clinicId, payload: null },
  ])("rejects malformed event %j", (event) => {
    expect(parseExportRequested(event)).toBeNull();
  });
});
