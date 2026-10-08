import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { roleSummarySchema } from "@eyadex/contracts/access";

import { closeHarness, openHarness, type Harness } from "../auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "./access-fixtures.ts";
import { createRole, roleAudit } from "./role-fixtures.ts";

// Codex on slice 8: a role name with a number split by an invisible separator, or a civil ID
// spaced in groups, reached the append-only audit (and the platform's admin-audit view) whole.
let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;

const ZWSP = String.fromCharCode(0x200b);
const PHONE = "50000000";
const CIVIL = "200000000000";
const digitsOf = (text: string) => text.replace(/\D/g, "");

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
});

afterAll(async () => {
  await closeHarness(h);
});

describe("role names in the audit snapshot", () => {
  it.each([
    [
      "a phone split by an invisible separator",
      `Call ${PHONE.slice(0, 1)}${ZWSP}${PHONE.slice(1)}`,
      PHONE,
    ],
    [
      "a civil ID spaced in groups",
      `ID ${CIVIL.slice(0, 4)} ${CIVIL.slice(4, 8)} ${CIVIL.slice(8)}`,
      CIVIL,
    ],
  ])("%s keeps none of its digits", async (_label, nameEn, value) => {
    const res = await createRole(h, A.admin.cookie, {
      nameAr: `دور ${nameEn}`,
      nameEn,
      permissionKeys: [],
    });
    expect(res.statusCode).toBe(201);
    const role = roleSummarySchema.parse(res.json());
    const [created] = await roleAudit(h, A.admin.clinicId, role.id);
    const after = (created!["details"] as { after: { nameAr: string; nameEn: string } }).after;
    for (const stored of [after.nameEn, after.nameAr, JSON.stringify(created!["details"])]) {
      expect(digitsOf(stored)).not.toContain(value.slice(-7));
    }
    // A phone keeps its last 3 digits at most; a civil ID none.
    expect(digitsOf(after.nameEn)).toBe(value.length === 12 ? "" : value.slice(-3));
  });

  it("the stored role name itself carries no invisible separator", async () => {
    const nameEn = `Front${ZWSP} desk ${Date.now()}`;
    const res = await createRole(h, A.admin.cookie, {
      nameAr: `استقبال ${Date.now()}`,
      nameEn,
      permissionKeys: [],
    });
    expect(res.statusCode).toBe(201);
    expect(roleSummarySchema.parse(res.json()).nameEn).not.toContain(ZWSP);
  });
});
