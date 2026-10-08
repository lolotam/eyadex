import { scrubAuditText } from "@eyadex/observability";
import { describe, expect, it } from "vitest";

import { ApiError } from "../../../shared/errors.ts";
import { matchActors } from "../domain/audit-actors.ts";
import { decodeAuditCursor } from "../domain/audit-cursor.ts";
import { refIdsOf, withRefNames } from "../domain/audit-refs.ts";
import { auditSnapshots } from "../domain/audit-snapshot.ts";

// Synthetic values only: zero-padded phone-shaped runs and an all-zero civil ID.
const ROLE = "0190a000-4000-7000-8000-000000000001";
const BRANCH = "0190a000-4000-7000-8000-000000000002";
const GONE = "0190a000-4000-7000-8000-000000000003";
const b64 = (text: string) => Buffer.from(text).toString("base64url");

describe("Unicode cannot hide a number from the reader", () => {
  it.each([
    ["a zero-width joiner", "Zed 5000‍0006", "Zed ***006"],
    ["LRM / RLM marks", "Zed 5000‎000‏7", "Zed ***007"],
    ["a soft hyphen and a BOM", "Zed 5000­00﻿08", "Zed ***008"],
    ["full-width digits", "Zed ５００００００９", "Zed ***009"],
    ["Arabic-Indic digits", "عربي ٥٠٠٠٠٠١٠", "عربي ***010"],
    ["Eastern Arabic-Indic digits", "Zed ۵۰۰۰۰۰۱۱", "Zed ***011"],
    ["digits glued to letters", "abc50000012xyz", "abc***012xyz"],
    ["a civil ID split by ZWNJ", "Id 3000‌00000000", "Id [REDACTED]"],
    ["a full-width civil ID", "Id ３０００００００００００", "Id [REDACTED]"],
  ])("%s", (_label, stored, shown) => {
    expect(scrubAuditText(stored)).toBe(shown);
  });

  it("applies to every snapshot string, ids and instants kept only under their own keys", () => {
    const { after } = auditSnapshots("invitation", {
      after: {
        fullName: "Sara 5000‍0013",
        email: "５０００００１４@example.test",
        roleId: ROLE,
        expiresAt: "2026-10-08T12:00:00.000Z",
        roleNameEn: ROLE,
      },
    });
    expect(after).toEqual({
      fullName: "Sara ***013",
      email: "***014@example.test",
      roleId: ROLE,
      expiresAt: "2026-10-08T12:00:00.000Z",
      // A UUID typed into a free-text field is only text: its long digit run is withheld.
      roleNameEn: "0190a[REDACTED]",
    });
  });
});

describe("actor search matches only what the reader sees", () => {
  const actors = [
    { userId: ROLE, name: "Twin password=alpha-hidden-value-1" },
    { userId: BRANCH, name: "Twin +96500000015 password=beta-hidden-value-2" },
  ];
  it.each(["password=alpha", "password=beta", "hidden-value", "300000", "5000000", "96500000015"])(
    "%s matches nobody",
    (search) => {
      expect(matchActors(search, actors, "Eyadex")).toEqual({ userIds: [], unnamed: false });
    },
  );
  it("the visible parts still match, the unnamed label too", () => {
    expect(matchActors("password=[redacted]", actors, "Eyadex").userIds).toEqual([ROLE, BRANCH]);
    expect(matchActors("015", actors, "Eyadex").userIds).toEqual([BRANCH]);
    expect(matchActors("eyad", actors, "Eyadex")).toEqual({ userIds: [], unnamed: true });
    expect(matchActors("０１５", actors, "Eyadex").userIds).toEqual([BRANCH]);
  });
});

describe("cursor instants PostgreSQL could not cast", () => {
  it.each([
    ["31 February", `2026-02-31T09:15:00.123456Z|${ROLE}`, "clinic"],
    ["year 0", `0000-01-01T00:00:00.000000Z|${ROLE}`, "clinic"],
    ["hour 24", `2026-01-01T24:00:00.000000Z|${ROLE}`, "clinic"],
    ["second 60", `2026-01-01T23:59:60.000000Z|${ROLE}`, "clinic"],
    ["31 February (platform)", `2026-02-31T09:15:00.123456Z|${ROLE}|clinic|${BRANCH}`, "platform"],
  ] as const)("%s is a validation error", (_label, text, kind) => {
    expect(() => decodeAuditCursor(b64(text), kind)).toThrow(ApiError);
  });
  it("a leap day and the last representable second pass", () => {
    expect(decodeAuditCursor(b64(`2028-02-29T23:59:59.999999Z|${ROLE}`), "clinic")).not.toBeNull();
  });
});

describe("role and branch references", () => {
  const roles = new Map([[ROLE, { nameAr: "طبيب", nameEn: "Doctor 50000016" }]]);
  const branches = new Map([[BRANCH, { nameAr: "فرع", nameEn: "Branch" }]]);
  it("collects ids and names them like the mock; an unreadable one keeps null names", () => {
    const snapshot = { roleId: ROLE, branchIds: [BRANCH, GONE], fullName: "Sara" };
    expect(refIdsOf([snapshot, null])).toEqual({ roles: [ROLE], branches: [BRANCH, GONE] });
    expect(withRefNames(snapshot, { roles, branches })).toEqual({
      roleId: { id: ROLE, nameAr: "طبيب", nameEn: "Doctor ***016" },
      branchIds: [
        { id: BRANCH, nameAr: "فرع", nameEn: "Branch" },
        { id: GONE, nameAr: null, nameEn: null },
      ],
      fullName: "Sara",
    });
    expect(withRefNames(null, { roles, branches })).toBeNull();
  });
});
