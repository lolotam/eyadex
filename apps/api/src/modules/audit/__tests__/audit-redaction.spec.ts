import { clinicAuditQuerySchema, platformAuditQuerySchema } from "@eyadex/contracts/audit-http";
import { scrubAuditText } from "@eyadex/observability";
import { describe, expect, it } from "vitest";

import { auditSnapshots } from "../domain/audit-snapshot.ts";

// Synthetic values only: an all-zero civil ID and phone-shaped runs of zeros.
const CIVIL_ID = "300000000000";
const PASSWORD = "recognisable-fake-audit-password-321";
const ID = "0190a000-4000-7000-8000-000000000001";

describe("shown text (actor and clinic names)", () => {
  it("drops a civil-ID run and credential text, and keeps 3 digits of a phone", () => {
    expect(scrubAuditText(`Sara +96500000005 ${CIVIL_ID} password=${PASSWORD}`)).toBe(
      "Sara ***005 [REDACTED] password=[REDACTED]",
    );
    expect(scrubAuditText("Sara Ahmad")).toBe("Sara Ahmad");
  });
});

describe("phone masking inside snapshots", () => {
  it("masks an email local part that is a phone, top-level and nested, at any depth", () => {
    const { after } = auditSnapshots("invitation", {
      after: { email: "50000001@example.test", roleId: ID, expiresAt: "2026-10-08T12:00:00.000Z" },
    });
    expect(after).toEqual({
      email: "***001@example.test",
      roleId: ID,
      expiresAt: "2026-10-08T12:00:00.000Z",
    });
    const clinic = auditSnapshots("clinic", {
      after: {
        slug: "clinic-a",
        firstAdmin: { invitationId: ID, email: "60000002@example.test" },
        modules: { notes: [`call 90000003 or ${CIVIL_ID}`] },
      },
    });
    expect(clinic.after).toEqual({
      slug: "clinic-a",
      firstAdmin: { invitationId: ID, email: "***002@example.test" },
      modules: { notes: ["call ***003 or [REDACTED]"] },
    });
  });
});

describe("date filters", () => {
  it.each(["bad", "2026-13-01", "2026-02-31", "0000-01-01", "2026-1-01"])(
    "refuses from=%s as a validation issue, without throwing",
    (from) => {
      expect(() => clinicAuditQuerySchema.safeParse({ from })).not.toThrow();
      expect(clinicAuditQuerySchema.safeParse({ from }).success).toBe(false);
      expect(platformAuditQuerySchema.safeParse({ to: from }).success).toBe(false);
    },
  );

  it("accepts real days, the first and last years PostgreSQL and ISO both hold included", () => {
    for (const day of ["2026-01-31", "2028-02-29", "0001-01-01", "9999-12-31"]) {
      expect(clinicAuditQuerySchema.safeParse({ from: day, to: day }).success).toBe(true);
    }
  });
});
