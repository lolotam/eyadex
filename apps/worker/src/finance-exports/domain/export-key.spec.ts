import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { financeExportKey } from "./export-key.ts";

const clinicId = "11111111-1111-4111-8111-111111111111";
const exportId = "22222222-2222-4222-8222-222222222222";

describe("financeExportKey", () => {
  it.each(["csv", "xlsx"] as const)("builds an id-only %s key", (extension) => {
    expect(financeExportKey({ clinicId, exportId, attempt: 3, extension })).toBe(
      `clinic/${clinicId}/finance-exports/${exportId}/3.${extension}`,
    );
  });

  it("lowercases uuid text so the key matches clinic_id::text", () => {
    const clinic = "aabbccdd-1111-4111-8111-aabbccddeeff";
    const exported = "00112233-4444-4555-8666-778899aabbcc";
    expect(
      financeExportKey({
        clinicId: clinic.toUpperCase(),
        exportId: exported.toUpperCase(),
        attempt: 1,
        extension: "csv",
      }),
    ).toBe(`clinic/${clinic}/finance-exports/${exported}/1.csv`);
  });

  it.each([0, 6, 1.5, -1, Number.NaN])("rejects attempt %s", (attempt) => {
    expect(financeExportKey({ clinicId, exportId, attempt, extension: "csv" })).toBeNull();
  });

  it("rejects unsafe ids, extensions, names and path pieces", () => {
    expect(
      financeExportKey({ clinicId: "../secret", exportId, attempt: 1, extension: "csv" }),
    ).toBeNull();
    expect(
      financeExportKey({ clinicId, exportId: "patient-name", attempt: 1, extension: "csv" }),
    ).toBeNull();
    expect(
      financeExportKey({ clinicId, exportId, attempt: 1, extension: "pdf" as "csv" }),
    ).toBeNull();
    expect(
      financeExportKey({ clinicId, exportId, attempt: 1, extension: "CSV" as "csv" }),
    ).toBeNull();
    expect(
      financeExportKey({ clinicId, exportId, attempt: 1, extension: "csv/../x" as "csv" }),
    ).toBeNull();
    expect(
      financeExportKey({ clinicId: `${clinicId}/token`, exportId, attempt: 1, extension: "xlsx" }),
    ).toBeNull();
  });

  it("accepts attempt 5 and embeds no name or token", () => {
    const key = financeExportKey({
      clinicId: randomUUID(),
      exportId: randomUUID(),
      attempt: 5,
      extension: "xlsx",
    });
    expect(key).toMatch(/^clinic\/[0-9a-f-]{36}\/finance-exports\/[0-9a-f-]{36}\/5\.xlsx$/);
    expect(key).not.toContain("token");
    expect(key).not.toContain("name");
  });
});
