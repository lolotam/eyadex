import { randomInt, randomUUID } from "node:crypto";

import postgres from "postgres";
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
  leakyBranchDetails,
  LEAKS,
  seedAudit,
  type ListBody,
} from "./audit-fixtures.ts";

// Story 22, PLAT-01, PLAT-02 over HTTP on real PostgreSQL + Redis (ADR-0019).
const URL = "/v1/platform/audit";
const TIE = "2031-02-04T00:00:00.000001Z";
const [CLINIC_TIE, PLATFORM_TIE] = [randomUUID(), randomUUID()].sort() as [string, string];
// One id in two clinics at one instant: allowed by the (clinic_id, id) keys, so the cursor must hold.
const SHARED_ID = randomUUID();
// A day no earlier run used: the database is shared between runs and is never emptied.
const SHARED_DAY = new Date(Date.UTC(2040, 0, 1) + randomInt(0, 20_000) * 86_400_000)
  .toISOString()
  .slice(0, 10);
const SHARED_AT = `${SHARED_DAY}T00:00:00.000001Z`;

let h: Harness;
let staff: Awaited<ReturnType<typeof platformStaff>>;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
let B: Awaited<ReturnType<typeof clinicWithMembers>>;
const ids: Record<string, string> = {};

const list = (cookie: string | undefined, query = "", host = PLATFORM) =>
  getList(h, host, URL, cookie, query);
const body = async (query = ""): Promise<ListBody> => {
  const res = await list(staff.cookie, query);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ListBody;
};
const every = (query = "") =>
  allPages((cursor) => body(`limit=3${query}${cursor === null ? "" : `&cursor=${cursor}`}`));

beforeAll(async () => {
  h = await openHarness({}, true);
  staff = await platformStaff(h);
  A = await clinicWithMembers(h);
  B = await clinicWithMembers(h);
  const admin = { clinicId: A.admin.clinicId, actorUserId: A.admin.userId };
  ids["branch"] = await seedAudit(h, {
    ...admin,
    action: "branch.updated",
    entityType: "branch",
    createdAt: "2031-02-01T00:00:00Z",
    details: leakyBranchDetails,
  });
  ids["patient"] = await seedAudit(h, {
    ...admin,
    action: "patient.opened",
    category: "patient_access",
    entityType: "patient",
    createdAt: "2031-02-02T00:00:00Z",
    details: { after: { fullName: "Someone", civilId: LEAKS.civilId, phone: LEAKS.phone } },
  });
  ids["feature"] = randomUUID();
  await h.owner`INSERT INTO platform_audit_log VALUES (${ids["feature"]}, ${staff.actorId},
    'clinic.feature_changed', ${A.admin.clinicId},
    ${h.owner.json({ module: "patients", before: { enabled: false }, after: { enabled: true } })},
    '2031-02-02T21:30:00Z')`;
  // One platform event and one clinic entry at the same instant: the tie crosses the union.
  await h.owner`INSERT INTO platform_audit_log VALUES (${PLATFORM_TIE}, ${staff.actorId},
    'clinic.limits_changed', ${A.admin.clinicId}, ${h.owner.json({})}, ${TIE})`;
  await seedAudit(h, {
    ...admin,
    id: CLINIC_TIE,
    action: "role.updated",
    entityType: "role",
    createdAt: TIE,
  });
  for (const clinic of [A, B]) {
    await seedAudit(h, {
      clinicId: clinic.admin.clinicId,
      actorUserId: clinic.admin.userId,
      id: SHARED_ID,
      action: "branch.created",
      entityType: "branch",
      createdAt: SHARED_AT,
    });
  }
});
afterAll(async () => {
  await closeHarness(h);
});

describe("PLAT-02: who may read the platform log", () => {
  it.each([URL, `${URL}/clinics`])(
    "%s: clinic host 404, clinic session 401, no TOTP 403",
    async (path) => {
      expect((await getList(h, APP, path, staff.cookie)).statusCode).toBe(404);
      expect((await getList(h, APP, path, A.admin.cookie)).statusCode).toBe(404);
      expect((await getList(h, PLATFORM, path, A.admin.cookie)).statusCode).toBe(401);
      expect((await getList(h, PLATFORM, path, undefined)).statusCode).toBe(401);
      expect((await getList(h, PLATFORM, path, staff.noTotpCookie)).statusCode).toBe(403);
    },
  );
});

describe("PLAT-01: patient access never reaches the platform", () => {
  it("a patient-access row is in no page, under no filter, and leaks nothing", async () => {
    const all = await every();
    expect(all.map((i) => i.id)).not.toContain(ids["patient"]);
    expect(all.map((i) => i.id)).toContain(ids["branch"]);
    expect((await body("action=patient.opened")).total).toBe(0);
    expect(
      (await body(`clinicId=${A.admin.clinicId}&source=clinic`)).items.map((i) => i.id),
    ).not.toContain(ids["patient"]);
    for (const text of [JSON.stringify(all), h.logs.join("\n")]) {
      for (const value of Object.values(LEAKS)) expect(text).not.toContain(value);
    }
  });

  it("eyadex_platform gets a permission error reading audit_log directly", async () => {
    const platform = postgres(process.env["EYADEX_TEST_PLATFORM_URL"]!, {
      max: 1,
      onnotice: () => undefined,
    });
    try {
      const failure = await platform`SELECT 1 FROM audit_log LIMIT 1`.catch(
        (error: unknown) => error,
      );
      expect(failure).toMatchObject({ code: "42501" });
    } finally {
      await platform.end();
    }
  });
});

describe("the platform log", () => {
  it("lists platform events and clinic administrative entries, newest first, with names", async () => {
    const all = await every();
    const instants = all.map((i) => i.at);
    expect(instants).toEqual([...instants].sort().reverse());
    const keys = all.map((i) => `${String(i["source"])}:${String(i["clinicId"])}:${i.id}`);
    expect(new Set(keys).size).toBe(all.length);
    expect((await body()).total).toBe(all.length);
    expect(all.find((i) => i.id === ids["feature"])).toMatchObject({
      source: "platform",
      entity: "clinic",
      category: "administrative",
      actorName: "staff",
      clinicId: A.admin.clinicId,
      clinicNameEn: "Acceptance Clinic",
      before: { module: "patients", enabled: false },
      after: { module: "patients", enabled: true },
    });
    expect(all.find((i) => i.id === ids["branch"])).toMatchObject({
      source: "clinic",
      entity: "branch",
      actorName: "Invited Admin",
      after: { nameEn: "New", phone: "***004" },
    });
  });

  it("the cursor holds across a tie between a platform event and a clinic entry", async () => {
    const day = `clinicId=${A.admin.clinicId}&from=2031-02-04&to=2031-02-04`;
    const first = await body(`limit=1&${day}`);
    const second = await body(`limit=1&${day}&cursor=${first.nextCursor}`);
    expect([...first.items, ...second.items].map((i) => i.id)).toEqual([PLATFORM_TIE, CLINIC_TIE]);
    expect(second.nextCursor).toBeNull();
  });

  it("the cursor holds when two clinics hold the same id at the same instant", async () => {
    const day = `action=branch.created&from=${SHARED_DAY}&to=${SHARED_DAY}`;
    const first = await body(`limit=1&${day}`);
    const second = await body(`limit=1&${day}&cursor=${first.nextCursor}`);
    const clinics = [A.admin.clinicId, B.admin.clinicId].sort().reverse();
    expect([...first.items, ...second.items].map((i) => [i.id, i["clinicId"]])).toEqual(
      clinics.map((clinicId) => [SHARED_ID, clinicId]),
    );
    expect(second.nextCursor).toBeNull();
  });

  it.each([
    ["source=platform", (i: ListBody["items"][number]) => i["source"] === "platform"],
    ["source=clinic", (i: ListBody["items"][number]) => i["source"] === "clinic"],
    ["entity=user", (i: ListBody["items"][number]) => i["entity"] === "user"],
    [
      "action=clinic.feature_changed",
      (i: ListBody["items"][number]) => i.action === "clinic.feature_changed",
    ],
    ["actor=STAFF", (i: ListBody["items"][number]) => i["actorName"] === "staff"],
  ])("filter %s returns exactly the matching rows", async (query, matches) => {
    const all = await every();
    const filtered = await every(`&${query}`);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.map((i) => i.id)).toEqual(all.filter(matches).map((i) => i.id));
  });

  it("filters one clinic, and days in Asia/Kuwait", async () => {
    const onlyB = await every(`&clinicId=${B.admin.clinicId}`);
    expect(onlyB.length).toBeGreaterThan(0);
    expect(onlyB.every((i) => i["clinicId"] === B.admin.clinicId)).toBe(true);
    // The feature change at 21:30 UTC on 2 February is 00:30 on 3 February in Kuwait.
    const day = (d: string) => every(`&clinicId=${A.admin.clinicId}&from=${d}&to=${d}`);
    expect((await day("2031-02-03")).map((i) => i.id)).toEqual([ids["feature"]]);
    expect((await day("2031-02-01")).map((i) => i.id)).toEqual([ids["branch"]]);
    expect(await day("2031-02-02")).toEqual([]);
  });

  it.each([
    ["an unknown parameter", "category=patient_access"],
    ["a malformed clinic id", "clinicId=nope"],
    ["the patient entity", "entity=patient"],
    ["a malformed cursor", `cursor=${Buffer.from(randomUUID()).toString("base64url")}`],
  ])("refuses %s with 400 validation", async (_label, query) => {
    const res = await list(staff.cookie, query);
    expect(res.statusCode).toBe(400);
  });

  it("offers every clinic by name for the clinic filter", async () => {
    const res = await getList(h, PLATFORM, `${URL}/clinics`, staff.cookie);
    expect(res.statusCode).toBe(200);
    const options = res.json() as { id: string; nameAr: string; nameEn: string }[];
    for (const clinic of [A, B]) {
      expect(options).toContainEqual({
        id: clinic.admin.clinicId,
        nameAr: "عيادة القبول",
        nameEn: "Acceptance Clinic",
      });
    }
    const [count] = await h.owner`SELECT count(*)::int AS n FROM clinics`;
    expect(options).toHaveLength(count!["n"] as number);
  });
});
