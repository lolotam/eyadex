import { describe, expect, it } from "vitest";

import { ApiError } from "../../../shared/errors.ts";
import { mayReadPatientAccess } from "../domain/audit-access.ts";
import { decodeAuditCursor, encodeAuditCursor } from "../domain/audit-cursor.ts";
import { auditSnapshots } from "../domain/audit-snapshot.ts";

const ID = "0190a000-0000-7000-8000-000000000001";
const AT = "2026-10-08T09:15:00.123456Z";
const b64 = (text: string) => Buffer.from(text).toString("base64url");

describe("audit cursor", () => {
  it("round-trips each list's full sort key, the instant to the microsecond", () => {
    const clinic = { kind: "clinic", at: AT, id: ID } as const;
    const platform = { kind: "platform", at: AT, id: ID, source: "clinic", clinicKey: ID } as const;
    expect(decodeAuditCursor(encodeAuditCursor(clinic), "clinic")).toEqual(clinic);
    expect(decodeAuditCursor(encodeAuditCursor(platform), "platform")).toEqual(platform);
    expect(decodeAuditCursor(undefined, "clinic")).toBeNull();
  });

  it.each([
    ["an id-only cursor (another list's)", "clinic", b64(ID)],
    ["a millisecond instant", "clinic", b64(`2026-10-08T09:15:00.123Z|${ID}`)],
    ["a non-uuid id", "clinic", b64(`${AT}|not-a-uuid`)],
    ["a platform cursor on the clinic list", "clinic", b64(`${AT}|${ID}|clinic|${ID}`)],
    ["a clinic cursor on the platform list", "platform", b64(`${AT}|${ID}`)],
    ["an unknown source", "platform", b64(`${AT}|${ID}|patient|${ID}`)],
    ["an impossible instant", "clinic", b64(`2026-13-45T09:15:00.123456Z|${ID}`)],
  ] as const)("refuses %s as validation", (_label, kind, raw) => {
    expect(() => decodeAuditCursor(raw, kind)).toThrow(ApiError);
  });
});

describe("audit snapshots", () => {
  it("keeps only the entity's allowlisted keys from before/after", () => {
    const details = {
      reason: "branch_deactivated",
      eventId: ID,
      before: { fullName: "Sara", email: "s@example.test", tokenHash: "abc", status: "pending" },
      after: { fullName: "Sara", status: "cancelled", password: "x" },
    };
    expect(auditSnapshots("invitation", details)).toEqual({
      before: { fullName: "Sara", email: "s@example.test", status: "pending" },
      after: { fullName: "Sara", status: "cancelled" },
    });
  });

  it("masks phones in free text and the phone field, and scrubs a civil ID typed into a name", () => {
    const { after } = auditSnapshots("branch", {
      after: {
        nameAr: "فرع 50000001",
        nameEn: "Branch 300000000000",
        address: "Call +965 0000 0002",
        phone: "+96500000003",
      },
    });
    const text = JSON.stringify(after);
    expect(text).not.toMatch(/50000001|0000 0002|300000000000|00000003/);
    expect(after?.["phone"]).toBe("***003");
  });

  it("copies a feature change's module into both sides", () => {
    expect(
      auditSnapshots("clinic", {
        module: "patients",
        before: { enabled: false },
        after: { enabled: true },
      }),
    ).toEqual({
      before: { module: "patients", enabled: false },
      after: { module: "patients", enabled: true },
    });
  });

  it("shows nothing for entities without an allowlist, and nothing for odd details", () => {
    const empty = { before: null, after: null };
    expect(
      auditSnapshots("patient", { after: { fullName: "x", civilId: "300000000000" } }),
    ).toEqual(empty);
    expect(auditSnapshots("platform_settings", { after: { anything: 1 } })).toEqual(empty);
    expect(auditSnapshots("user", null)).toEqual(empty);
    expect(auditSnapshots("user", { before: ["x"], after: "x" })).toEqual(empty);
    expect(auditSnapshots("clinic_mail_provider", {})).toEqual(empty);
  });
});

describe("patient-access rows in the clinic log", () => {
  it("need view:patients:clinic (TODO(spec)); branch scope or the audit key alone are not enough", () => {
    expect(mayReadPatientAccess(["view:audit_log:clinic", "view:patients:clinic"])).toBe(true);
    expect(mayReadPatientAccess(["view:audit_log:clinic", "view:patients:branch"])).toBe(false);
    expect(mayReadPatientAccess(["view:audit_log:clinic"])).toBe(false);
  });
});
