import { randomUUID } from "node:crypto";

import { platformClinicListResponseSchema } from "@eyadex/contracts/platform-clinics";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  APP,
  call,
  closeHarness,
  openHarness,
  PLATFORM,
  type Harness,
} from "../../identity/auth/__tests__/auth-http-harness.ts";
import { clinicWithMembers } from "../../identity/__tests__/access-fixtures.ts";
import { platformStaff } from "./platform-staff.ts";

// Story 18 list (ADR-0016) over HTTP on real PostgreSQL + Redis.
let h: Harness;
let staff: Awaited<ReturnType<typeof platformStaff>>;
const tag = `lst${randomUUID().slice(0, 6)}`;
// Its own search tag, so the microsecond pair stays out of the other tests' pages and totals.
const microTag = `usx${randomUUID().slice(0, 6)}`;
// Fresh ids per run (the database is shared); the same prefix keeps tieLow < tieHigh.
const prefix = randomUUID().slice(0, -4);
const ids = {
  old: `${prefix}a001`,
  tieLow: `${prefix}a002`,
  tieHigh: `${prefix}a003`,
  microOlder: `${prefix}a004`,
  microNewer: `${prefix}a005`,
};

// `::text` first: postgres.js would serialise a timestamptz parameter through a JS Date (milliseconds).
async function seedClinic(id: string, suffix: string, createdAt: string, extra: Partial<Row> = {}) {
  const row: Row = { status: "active", specialty: "general", tag, ...extra };
  await h.owner`INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language,
      timezone, status, expires_at, max_users, max_branches, created_at, updated_at)
    VALUES (${id}, ${`${row.tag}-${suffix}`}, ${`عيادة ${suffix}`}, ${`Clinic ${row.tag} ${suffix}`},
      ${row.specialty}, 'en', 'Africa/Cairo', ${row.status}, '2099-01-01T00:00:00Z', 4, 2,
      ${createdAt}::text::timestamptz, ${createdAt}::text::timestamptz)`;
}
type Row = { status: string; specialty: string; tag: string };

const list = (query: string, cookie = staff.cookie, host = PLATFORM) =>
  call(h, { method: "GET", url: `/v1/platform/clinics${query}`, host, cookie });

beforeAll(async () => {
  h = await openHarness({}, true);
  staff = await platformStaff(h);
  await seedClinic(ids.old, "old", "2030-01-01T00:00:00Z", { specialty: "dental" });
  // Two clinics share created_at: the id breaks the tie, so the cursor never skips or repeats.
  await seedClinic(ids.tieLow, "tie-a", "2030-02-01T00:00:00Z", { status: "suspended" });
  await seedClinic(ids.tieHigh, "tie-b", "2030-02-01T00:00:00Z");
  // Same millisecond, different microseconds: a cursor rounded to milliseconds would skip the older.
  await seedClinic(ids.microOlder, "lo", "2031-01-01T00:00:00.000100Z", { tag: microTag });
  await seedClinic(ids.microNewer, "hi", "2031-01-01T00:00:00.000900Z", { tag: microTag });
});

afterAll(async () => {
  await closeHarness(h);
});

describe("GET /v1/platform/clinics", () => {
  it("newest first, the id breaks a created_at tie, and the cursor pages without gaps", async () => {
    const first = await list(`?search=${tag}&limit=2`);
    expect(first.statusCode).toBe(200);
    const page1 = platformClinicListResponseSchema.parse(first.json());
    expect(page1.items.map((c) => c.id)).toEqual([ids.tieHigh, ids.tieLow]);
    expect(page1.total).toBe(3);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = platformClinicListResponseSchema.parse(
      (await list(`?search=${tag}&limit=2&cursor=${page1.nextCursor}`)).json(),
    );
    expect(page2.items.map((c) => c.id)).toEqual([ids.old]);
    expect(page2.total).toBe(3);
    expect(page2.nextCursor).toBeNull();
  });

  it("the cursor keeps microseconds, so two clinics in the same millisecond both appear", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query = `?search=${microTag}&limit=1${cursor ? `&cursor=${cursor}` : ""}`;
      const page = platformClinicListResponseSchema.parse((await list(query)).json());
      seen.push(...page.items.map((c) => c.id));
      cursor = page.nextCursor;
    } while (cursor !== null && seen.length < 5);
    expect(seen).toEqual([ids.microNewer, ids.microOlder]);
  });

  it("every item is the detail shape with the clinic's zone, language and creation time", async () => {
    const body = (await list(`?search=${tag}-old`)).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: ids.old,
      timezone: "Africa/Cairo",
      defaultLanguage: "en",
      createdAt: "2030-01-01T00:00:00.000Z",
      usage: { users: { used: 0, max: 4 }, branches: { used: 0, max: 2 } },
    });
    expect(JSON.stringify(body)).not.toMatch(/patientCount|civil|"phone"/i);
  });

  it("filters by status, specialty, Arabic name and slug", async () => {
    const ids_ = async (q: string) => (await list(q)).json().items.map((c: { id: string }) => c.id);
    expect(await ids_(`?search=${tag}&status=suspended`)).toEqual([ids.tieLow]);
    expect(await ids_(`?search=${tag}&specialty=dental`)).toEqual([ids.old]);
    expect(await ids_(`?search=${encodeURIComponent(`عيادة tie-b`)}&limit=100`)).toContain(
      ids.tieHigh,
    );
    expect(await ids_(`?search=${tag}-tie-a`)).toEqual([ids.tieLow]);
    // A LIKE wildcard is literal text, not "everything".
    expect((await list(`?search=%25${tag}`)).json().total).toBe(0);
  });

  it("NEGATIVE: bad cursor, limit above 100 and an unknown filter are 400", async () => {
    expect((await list("?cursor=bm90LWEtY3Vyc29y")).statusCode).toBe(400);
    expect((await list("?limit=101")).statusCode).toBe(400);
    expect((await list("?patients=1")).statusCode).toBe(400);
  });

  it("NEGATIVE: clinic host → 404, clinic session → 401, no TOTP → two_factor_required", async () => {
    expect((await list("", staff.cookie, APP)).statusCode).toBe(404);
    const { admin } = await clinicWithMembers(h);
    const asClinic = await list("", admin.cookie);
    expect([401, 403]).toContain(asClinic.statusCode);
    expect(asClinic.json().items).toBeUndefined();
    const anonymous = await call(h, { method: "GET", url: "/v1/platform/clinics", host: PLATFORM });
    expect(anonymous.statusCode).toBe(401);
    const noTotp = await list("", staff.noTotpCookie);
    expect(noTotp.statusCode).toBe(403);
    expect(noTotp.json().code).toBe("two_factor_required");
  });
});
