import { describe, expect, it } from "vitest";
import { DatabaseError } from "@eyadex/db";
import { pdfRevision } from "../domain/pdf-revision.ts";
import { pdfAdmissionQuota } from "../persistence/pg-pdf-admission-error.ts";

describe("PDF admission identity and failure classification", () => {
  it("preserves bigint revisions and changes identity for every display source", () => {
    const revisions = { clinic: "9007199254740993", branch: "2", patient: "3" };
    expect(pdfRevision("typst-v1", revisions)).toBe("typst-v1:9007199254740993:2:3");
    for (const key of ["clinic", "branch", "patient"] as const)
      expect(pdfRevision("typst-v1", { ...revisions, [key]: "4" })).not.toBe(
        pdfRevision("typst-v1", revisions),
      );
    expect(pdfRevision("typst-v2", revisions)).not.toBe(pdfRevision("typst-v1", revisions));
  });
  it("rejects invalid or oversized trusted configuration", () => {
    for (const renderer of ["", "bad:revision", "x".repeat(256)])
      expect(() => pdfRevision(renderer, { clinic: "1", branch: "1", patient: "1" })).toThrow();
  });
  it("only accepts the named quota constraints and never error-shaped objects", () => {
    expect(
      pdfAdmissionQuota(
        new DatabaseError({ code: "23514", constraint: "invoice_pdf_capacity_admitted_check" }),
      ),
    ).toBe(true);
    expect(
      pdfAdmissionQuota(
        new DatabaseError({ code: "23505", constraint: "invoice_pdf_clinic_capacity" }),
      ),
    ).toBe(true);
    for (const constraint of ["invoices_pkey", "invoice_pdf_current_generation", "other"])
      expect(pdfAdmissionQuota(new DatabaseError({ code: "23505", constraint }))).toBe(false);
    expect(
      pdfAdmissionQuota({ code: "23514", constraint: "invoice_pdf_capacity_admitted_check" }),
    ).toBe(false);
    expect(pdfAdmissionQuota(new Error("connection lost"))).toBe(false);
  });
});
