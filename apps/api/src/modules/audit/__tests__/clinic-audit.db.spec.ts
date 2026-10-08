import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AUTHORIZATION_INVALIDATOR, type AuthorizationInvalidator } from "../../identity/index.ts";
import {
  APP,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";
import {
  allPages,
  getList,
  leakyBranchDetails,
  LEAKS,
  LEAKY_TEXT,
  seedLeakyMember,
  seedAudit,
  type ListBody,
} from "./audit-fixtures.ts";

// Story 53, ISO-02, RBAC-01 over HTTP on real PostgreSQL + Redis (ADR-0019).
const URL = "/v1/clinic/audit";
const TIE = "2031-01-01T00:00:00.000001Z";
// Fresh ids each run: the database is shared, and a clinic's id is unique only inside it.
const [TIE_LOW, TIE_HIGH] = [randomUUID(), randomUUID()].sort() as [string, string];

let h: Harness;
let A: Awaited<ReturnType<typeof clinicWithMembers>>;
let B: Awaited<ReturnType<typeof clinicWithMembers>>;
const ids: Record<string, string> = {};

const list = (cookie: string | undefined, query = "", host = APP) =>
  getList(h, host, URL, cookie, query);
const body = async (cookie: string, query = ""): Promise<ListBody> => {
  const res = await list(cookie, query);
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ListBody;
};
const every = (cookie: string, query = "") =>
  allPages((cursor) =>
    body(cookie, `limit=2${query}${cursor === null ? "" : `&cursor=${cursor}`}`),
  );

beforeAll(async () => {
  h = await openHarness({}, true);
  A = await clinicWithMembers(h);
  B = await clinicWithMembers(h);
  const admin = { clinicId: A.admin.clinicId, actorUserId: A.admin.userId };
  ids["tieLow"] = await seedAudit(h, {
    ...admin,
    id: TIE_LOW,
    action: "branch.updated",
    entityType: "branch",
    createdAt: TIE,
  });
  ids["tieHigh"] = await seedAudit(h, {
    ...admin,
    id: TIE_HIGH,
    action: "branch.updated",
    entityType: "branch",
    createdAt: TIE,
  });
  ids["patient"] = await seedAudit(h, {
    ...admin,
    action: "patient.opened",
    category: "patient_access",
    entityType: "patient",
    createdAt: "2031-01-02T00:00:00Z",
    details: { after: { fullName: "Someone", civilId: LEAKS.civilId, phone: LEAKS.phone } },
  });
  ids["leaky"] = await seedAudit(h, {
    ...admin,
    action: "branch.updated",
    entityType: "branch",
    createdAt: "2031-01-03T00:00:00Z",
    details: leakyBranchDetails,
  });
  // 21:30 UTC on 1 June is 00:30 on 2 June in Asia/Kuwait.
  ids["late"] = await seedAudit(h, {
    ...admin,
    action: "role.updated",
    entityType: "role",
    createdAt: "2029-06-01T21:30:00Z",
  });
  // An actor with no membership here: a platform account acting for the clinic, or a system actor.
  ids["unnamed"] = await seedAudit(h, {
    clinicId: A.admin.clinicId,
    actorUserId: randomUUID(),
    action: "invitation.resent",
    entityType: "invitation",
    createdAt: "2030-01-01T00:00:00Z",
  });
  ids["leakyActor"] = await seedAudit(h, {
    clinicId: A.admin.clinicId,
    actorUserId: await seedLeakyMember(h, A.admin.clinicId, A.doctor.roleId),
    action: "user.profile_updated",
    entityType: "user",
    createdAt: "2030-01-02T00:00:00Z",
  });
  ids["otherClinic"] = await seedAudit(h, {
    clinicId: B.admin.clinicId,
    actorUserId: B.admin.userId,
    action: "branch.created",
    entityType: "branch",
    createdAt: "2031-01-05T00:00:00Z",
  });
});
afterAll(async () => {
  await closeHarness(h);
});

describe("RBAC-01: GET /v1/clinic/audit", () => {
  it("no session 401, a role without view:audit_log:clinic 403, the platform host 404", async () => {
    expect((await list(undefined)).statusCode).toBe(401);
    expect((await list(A.doctor.cookie)).statusCode).toBe(403);
    expect((await list(A.admin.cookie, "", PLATFORM)).statusCode).toBe(404);
  });
});

describe("the clinic's own log", () => {
  it("every row of the clinic, newest first, no repeats across pages — and none of another clinic (ISO-02)", async () => {
    const items = await every(A.admin.cookie);
    const stored = await h.owner`SELECT id FROM audit_log WHERE clinic_id = ${A.admin.clinicId}
                                 ORDER BY created_at DESC, id DESC`;
    expect(items.map((i) => i.id)).toEqual(stored.map((r) => r["id"]));
    expect((await body(A.admin.cookie)).total).toBe(stored.length);
    expect(items.map((i) => i.id)).not.toContain(ids["otherClinic"]);
    expect((await every(B.admin.cookie)).map((i) => i.id)).toContain(ids["otherClinic"]);
    expect((await every(B.admin.cookie)).map((i) => i.id)).not.toContain(ids["leaky"]);
  });

  it("the cursor holds across a created_at tie: the higher id first, each row once", async () => {
    const pages: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `limit=1&action=branch.updated${cursor === null ? "" : `&cursor=${cursor}`}`;
      const page = await body(A.admin.cookie, query);
      pages.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(pages).toEqual([ids["leaky"], TIE_HIGH, TIE_LOW]);
  });

  it("names members, shows other actors as Eyadex, and files invitation acceptance under users", async () => {
    const items = await every(A.admin.cookie);
    expect(items.find((i) => i.id === ids["unnamed"])?.["actorName"]).toBe("Eyadex");
    const accepted = items.filter((i) => i.action === "invitation.accepted");
    expect(accepted.map((i) => i["entity"])).toEqual(["user", "user"]);
    expect(accepted.map((i) => i["actorName"]).sort()).toEqual(["Branch Doctor", "Invited Admin"]);
    expect(items.find((i) => i.id === ids["leaky"])?.["actorName"]).toBe("Invited Admin");
  });

  it("an actor name keeps no civil ID, credential or full phone", async () => {
    const name = (await every(A.admin.cookie)).find((i) => i.id === ids["leakyActor"])?.[
      "actorName"
    ];
    expect(name).toBe("Leaky ***004 [REDACTED] password=[REDACTED]");
    expect(name).not.toBe(LEAKY_TEXT);
  });

  it.each([
    ["entity=user", (i: ListBody["items"][number]) => i["entity"] === "user"],
    ["entity=branch", (i: ListBody["items"][number]) => i["entity"] === "branch"],
    ["category=patient_access", (i: ListBody["items"][number]) => i.id === ids["patient"]],
    ["action=role.updated", (i: ListBody["items"][number]) => i.id === ids["late"]],
    ["actor=eyadex", (i: ListBody["items"][number]) => i["actorName"] === "Eyadex"],
    ["actor=INVITED%20admin", (i: ListBody["items"][number]) => i["actorName"] === "Invited Admin"],
  ])("filter %s returns exactly the matching rows", async (query, matches) => {
    const all = await every(A.admin.cookie);
    const filtered = await every(A.admin.cookie, `&${query}`);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.map((i) => i.id)).toEqual(all.filter(matches).map((i) => i.id));
    expect((await body(A.admin.cookie, query)).total).toBe(filtered.length);
  });

  it("date filters are calendar days in the clinic's time zone", async () => {
    const day = async (d: string) =>
      (await every(A.admin.cookie, `&from=${d}&to=${d}`)).map((i) => i.id);
    expect(await day("2029-06-02")).toEqual([ids["late"]]);
    expect(await day("2029-06-01")).toEqual([]);
    expect((await every(A.admin.cookie, "&from=2031-01-03")).map((i) => i.id)).toEqual([
      ids["leaky"],
    ]);
  });

  it.each([
    ["a malformed cursor", "cursor=bm9wZQ"],
    ["an unknown parameter", "clinicId=x"],
    ["an impossible day", "from=2026-02-31"],
    ["a zero limit", "limit=0"],
    ["an unparseable day", "from=bad"],
    ["a thirteenth month", "from=2026-13-01"],
    ["year zero", "to=0000-01-01"],
    ["an unknown entity", "entity=patient_file"],
  ])("refuses %s with 400 validation", async (_label, query) => {
    const res = await list(A.admin.cookie, query);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "validation" });
  });
});

describe("patient access and hidden fields", () => {
  it("patient-access rows need view:patients:clinic as well (TODO(spec))", async () => {
    await h.owner`INSERT INTO role_permissions VALUES (${A.admin.clinicId}, gen_random_uuid(),
      ${A.doctor.roleId}, (SELECT id FROM permissions WHERE key = 'view:audit_log:clinic'), now())`;
    await h.app
      .get<AuthorizationInvalidator>(AUTHORIZATION_INVALIDATOR)
      .clinicChanged(A.admin.clinicId);
    const doctor = await every(A.doctor.cookie);
    expect(doctor.length).toBeGreaterThan(0);
    expect(doctor.map((i) => i["category"])).not.toContain("patient_access");
    expect((await body(A.doctor.cookie, "category=patient_access")).total).toBe(0);
    const admin = await every(A.admin.cookie, "&category=patient_access");
    expect(admin).toEqual([
      expect.objectContaining({ id: ids["patient"], before: null, after: null }),
    ]);
  });

  it("no token, password, civil ID or full phone in any answer or log line", async () => {
    const pages = await allPages((cursor) =>
      list(A.admin.cookie, `limit=100${cursor === null ? "" : `&cursor=${cursor}`}`).then(
        (res) => res.json() as ListBody,
      ),
    );
    const leaky = pages.find((i) => i.id === ids["leaky"]);
    expect(leaky?.["before"]).toEqual({ nameAr: "قديم", nameEn: "Old", isActive: true });
    expect(leaky?.["after"]).toMatchObject({ nameEn: "New", phone: "***004", isActive: true });
    for (const text of [JSON.stringify(pages), h.logs.join("\n")]) {
      for (const value of Object.values(LEAKS)) expect(text).not.toContain(value);
    }
  });
});
