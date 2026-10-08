import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  APP,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";
import { platformStaff } from "../../platform/__tests__/platform-staff.ts";
import {
  allPages,
  getList,
  HIDDEN,
  HIDDEN_SHOWN,
  seedAudit,
  seedLeakyMember,
  type ListBody,
} from "./audit-fixtures.ts";

// Codex round 2 on slice 10 (ADR-0019): Unicode-hidden numbers, the actor search as an oracle,
// cursor instants PostgreSQL cannot cast, and role/branch names in snapshots — on both lists.
let h: Harness;
let staff: Awaited<ReturnType<typeof platformStaff>>;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
const rowOf: Partial<Record<keyof typeof HIDDEN, string>> = {};
const ids: Record<string, string> = {};
const GONE_BRANCH = randomUUID();
let clinicL = "";

type Area = "clinic" | "platform";
const read = async (area: Area, query: string): Promise<ListBody> => {
  const res =
    area === "clinic"
      ? await getList(h, APP, "/v1/clinic/audit", A.admin.cookie, query)
      : await getList(h, PLATFORM, "/v1/platform/audit", staff.cookie, query);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ListBody;
};
// The platform list is global and the database is shared between runs: look at this run's clinic.
const scope = (area: Area) => (area === "platform" ? `&clinicId=${A.admin.clinicId}` : "");
const inA = (area: Area, query = "") =>
  allPages((cursor) =>
    read(area, `limit=50${scope(area)}${query}${cursor === null ? "" : `&cursor=${cursor}`}`),
  );

beforeAll(async () => {
  h = await openHarness({}, true);
  staff = await platformStaff(h);
  A = await clinicWithMembers(h);
  const base = {
    clinicId: A.admin.clinicId,
    entityType: "user",
    createdAt: "2032-03-01T00:00:00Z",
  };
  for (const key of Object.keys(HIDDEN) as (keyof typeof HIDDEN)[]) {
    const actorUserId = await seedLeakyMember(h, A.admin.clinicId, A.doctor.roleId, HIDDEN[key]);
    rowOf[key] = await seedAudit(h, { ...base, actorUserId, action: "user.profile_updated" });
  }
  ids["refs"] = await seedAudit(h, {
    ...base,
    actorUserId: A.admin.userId,
    action: "user.role_changed",
    details: {
      after: {
        fullName: "Sara",
        roleId: A.doctor.roleId,
        branchIds: [A.doctor.branchId, GONE_BRANCH],
      },
    },
  });
  clinicL = randomUUID();
  await h.owner`INSERT INTO clinics VALUES (${clinicL}, ${`hard-${clinicL.slice(0, 8)}`},
    ${HIDDEN.zwj}, ${HIDDEN.fullWidth}, 'general', 'ar', 'Asia/Kuwait', 'active',
    now() + interval '30 days', 5, 2, now(), now())`;
  ids["clinicL"] = randomUUID();
  await h.owner`INSERT INTO platform_audit_log VALUES (${ids["clinicL"]}, ${staff.actorId},
    'clinic.limits_changed', ${clinicL}, ${h.owner.json({})}, '2032-03-01T00:00:00Z')`;
});
afterAll(async () => {
  await closeHarness(h);
});

describe.each(["clinic", "platform"] as const)("%s list", (area) => {
  it("shows names with Unicode-hidden numbers masked", async () => {
    const items = await inA(area);
    for (const key of Object.keys(HIDDEN) as (keyof typeof HIDDEN)[]) {
      expect(items.find((i) => i.id === rowOf[key])?.["actorName"], key).toBe(HIDDEN_SHOWN[key]);
    }
  });

  it.each(["password=alpha", "password=beta", "alpha-hidden", "300000", "50000", "0006", "٥٠٠"])(
    "actor=%s cannot see past the redaction: no rows, total 0",
    async (search) => {
      const page = await read(area, `actor=${encodeURIComponent(search)}${scope(area)}`);
      expect(page.total).toBe(0);
      expect(page.items).toEqual([]);
    },
  );

  it("the visible text still matches both twins alike", async () => {
    const twins = await inA(area, `&actor=${encodeURIComponent("password=[REDACTED]")}`);
    expect(twins.map((i) => i.id).sort()).toEqual([rowOf.alpha, rowOf.beta].sort());
  });

  it("names roles and branches in snapshots; an unknown branch keeps null names", async () => {
    const [role] = await h.owner`SELECT name_ar, name_en FROM roles WHERE id = ${A.doctor.roleId}`;
    const item = (await inA(area)).find((i) => i.id === ids["refs"]);
    expect(item?.["after"]).toEqual({
      fullName: "Sara",
      roleId: { id: A.doctor.roleId, nameAr: role!["name_ar"], nameEn: role!["name_en"] },
      branchIds: [
        { id: A.doctor.branchId, nameAr: "فرع", nameEn: "Branch" },
        { id: GONE_BRANCH, nameAr: null, nameEn: null },
      ],
    });
  });
});

describe("cursor instants PostgreSQL could not cast answer 400", () => {
  const b64 = (text: string) => Buffer.from(text).toString("base64url");
  const id = randomUUID();
  it.each([
    ["clinic", `2026-02-31T09:15:00.123456Z|${id}`],
    ["clinic", `0000-01-01T00:00:00.000000Z|${id}`],
    ["platform", `2026-02-31T09:15:00.123456Z|${id}|clinic|${id}`],
    ["platform", `0000-01-01T00:00:00.000000Z|${id}|platform|${id}`],
  ] as const)("%s list, %s", async (area, text) => {
    const res =
      area === "clinic"
        ? await getList(h, APP, "/v1/clinic/audit", A.admin.cookie, `cursor=${b64(text)}`)
        : await getList(h, PLATFORM, "/v1/platform/audit", staff.cookie, `cursor=${b64(text)}`);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "validation" });
  });
});

describe("clinic names with Unicode-hidden numbers", () => {
  it("are masked in the platform list and the clinic options", async () => {
    const page = await read("platform", `clinicId=${clinicL}`);
    expect(page.items[0]).toMatchObject({
      id: ids["clinicL"],
      clinicNameAr: HIDDEN_SHOWN.zwj,
      clinicNameEn: HIDDEN_SHOWN.fullWidth,
    });
    const res = await getList(h, PLATFORM, "/v1/platform/audit/clinics", staff.cookie);
    const option = (res.json() as { id: string }[]).find((o) => o.id === clinicL);
    expect(option).toEqual({
      id: clinicL,
      nameAr: HIDDEN_SHOWN.zwj,
      nameEn: HIDDEN_SHOWN.fullWidth,
    });
  });
});
