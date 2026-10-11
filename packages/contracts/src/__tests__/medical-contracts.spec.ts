import { describe, expect, it } from "vitest";
import {
  visitDiagnosesInputSchema,
  visitListQuerySchema,
  visitNoteInputSchema,
  visitSearchSchema,
  visitStartSchema,
  walkInSearchSchema,
} from "../visits.ts";
import { permissionSchema, PERMISSION_CATALOG } from "../permissions.ts";
import { PLATFORM_AUDIT_ACTIONS, platformAuditEntitySchema } from "../audit.ts";

describe("P2 contracts", () => {
  it("starts a visit from an appointment or as a walk-in, never both", () => {
    const id = "01890000-0000-7000-8000-000000000001";
    expect(visitStartSchema.safeParse({ appointmentId: id }).success).toBe(true);
    expect(visitStartSchema.safeParse({ patientId: id, branchId: id }).success).toBe(true);
    expect(visitStartSchema.safeParse({ appointmentId: id, patientId: id }).success).toBe(false);
  });
  it("takes ICD-10-CM codes or free text per diagnosis", () => {
    const ok = visitDiagnosesInputSchema.safeParse({
      items: [
        { kind: "icd10", code: "F41.1", text: "Generalized anxiety disorder" },
        { kind: "text", text: "قلق" },
      ],
    });
    expect(ok.success).toBe(true);
    expect(
      visitDiagnosesInputSchema.safeParse({ items: [{ kind: "icd10", code: "41.1", text: "x" }] })
        .success,
    ).toBe(false);
  });
  it("bounds note sections", () => {
    expect(
      visitNoteInputSchema.safeParse({
        complaint: "x".repeat(4001),
        examination: null,
        assessment: null,
        plan: null,
      }).success,
    ).toBe(false);
  });
  it("knows the new keys and refuses impossible ones", () => {
    for (const key of [
      "view:visits:own",
      "create:visits:own",
      "view:medical:clinic",
      "update:medical:own",
      "update:medicines:clinic",
    ]) {
      expect(permissionSchema.safeParse(key).success).toBe(true);
    }
    expect(PERMISSION_CATALOG.some((p) => p.key === "create:visits:clinic")).toBe(false);
    expect(PERMISSION_CATALOG.some((p) => p.key === "view:medical:branch")).toBe(false);
  });
  it("keeps note-search text out of the URL: only the POST body takes `q` (R2-1)", () => {
    expect(visitListQuerySchema.safeParse({ q: "anxiety" }).success).toBe(false);
    expect(visitSearchSchema.safeParse({ q: "anxiety" }).success).toBe(true);
    expect(visitSearchSchema.safeParse({ q: "​" }).success).toBe(false);
  });
  it("needs two characters to search walk-in candidates (R3-1)", () => {
    const branchId = "01890000-0000-7000-8000-000000000001";
    expect(walkInSearchSchema.safeParse({ branchId, q: "a" }).success).toBe(false);
    expect(walkInSearchSchema.safeParse({ branchId, q: "ab" }).success).toBe(true);
  });
  it("never offers the platform a medical entity or action (R3-4)", () => {
    for (const entity of ["visit", "medical_profile", "attachment", "medicine"]) {
      expect(platformAuditEntitySchema.safeParse(entity).success).toBe(false);
    }
    const medical = /^(visit|medical_profile|attachment|medicine)\./;
    expect(PLATFORM_AUDIT_ACTIONS.filter((a) => medical.test(a))).toEqual([]);
  });
});
