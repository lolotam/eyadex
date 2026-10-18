import type { InvoiceListQuery } from "@eyadex/contracts/finance";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../../shared/errors.ts";
import { listInvoices } from "../queries/invoice-list.ts";

describe("invoice list patient-name integrity", () => {
  it("fails internally without exposing identifiers when a page patient name is missing", async () => {
    const clinicId = "0190a000-0000-7000-8000-000000000001";
    const patientId = "0190a000-0000-7000-8000-000000000002";
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{ patient_id: patientId }]);
    const tx = { execute } as unknown as Tx;
    const patients = { displayNames: vi.fn().mockResolvedValue(new Map<string, string>()) };
    const query: InvoiceListQuery = { limit: 1, encounter: false };
    const result = listInvoices(tx, clinicId, query, sql`true`, patients);
    await expect(result).rejects.toMatchObject({
      code: "unknown",
      status: 500,
      details: undefined,
    });
    await expect(result).rejects.toEqual(new ApiError("unknown"));
    expect(patients.displayNames).toHaveBeenCalledExactlyOnceWith(tx, clinicId, [patientId]);
  });
});
