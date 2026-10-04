import { createDatabase, type Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PgSeatUsageReader } from "../persistence/pg-seat-usage-reader.ts";

// Same pattern as the tenancy db test: owner for fixtures, eyadex_app for the code under test.
const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set — @eyadex/api test:db needs the owner and eyadex_app URLs`);
  }
  return value;
};
const OWNER_URL = required("EYADEX_TEST_OWNER_URL");
const APP_URL = required("EYADEX_TEST_APP_URL");
const newId = systemUuidV7().newId;

const now = new Date("2029-12-31T00:00:00.000Z");

/** Seeds a clinic with 2 active + 1 deactivated memberships and 4 invitations around `now`. */
async function seedClinic(owner: Sql): Promise<string> {
  const clinicId = newId();
  const roleId = newId();
  await owner.begin(async (tx) => {
    await tx`INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language,
        timezone, status, expires_at, max_users, max_branches, created_at, updated_at)
      VALUES (${clinicId}, ${`seats-${clinicId}`}, 'عيادة', 'Clinic', 'general', 'ar',
        'Asia/Kuwait', 'active', '2030-06-01T00:00:00Z', 10, 3, now(), now())`;
    await tx`INSERT INTO roles (clinic_id, id, system_key, name_ar, name_en, is_locked, is_active, created_at, updated_at)
      VALUES (${clinicId}, ${roleId}, 'doctor', 'طبيب', 'Doctor', false, true, now(), now())`;
    for (const status of ["active", "active", "deactivated"] as const) {
      await tx`INSERT INTO memberships (clinic_id, id, user_id, full_name, email, role_id, all_branches,
          status, preferred_language, last_login_at, created_at, updated_at)
        VALUES (${clinicId}, ${newId()}, ${newId()}, 'عضو', ${`m-${newId()}@example.com`}, ${roleId},
          true, ${status}, 'ar', NULL, now(), now())`;
    }
    // live; expired; expiring exactly at `now` (not live: expires_at > now is exclusive); accepted.
    for (const [status, expiry] of [
      ["pending", "2030-01-05T00:00:00Z"],
      ["pending", "2029-12-30T00:00:00Z"],
      ["pending", now.toISOString()],
      ["accepted", "2030-01-05T00:00:00Z"],
    ] as const) {
      await tx`INSERT INTO invitations (clinic_id, id, email, full_name, role_id, all_branches, status,
          expires_at, invited_by_user_id, token_hash, created_at, responded_at)
        VALUES (${clinicId}, ${newId()}, ${`i-${newId()}@example.com`}, 'مدعو', ${roleId}, true,
          ${status}, ${expiry}, ${newId()}, ${`seats-${newId()}`}, now(),
          ${status === "accepted" ? now : null})`;
    }
  });
  return clinicId;
}

let owner: Sql;
let db: Database;
let A: string;
let B: string;

beforeAll(async () => {
  owner = postgres(OWNER_URL, { max: 1, onnotice: () => undefined });
  A = await seedClinic(owner);
  B = await seedClinic(owner);
  db = createDatabase({ url: APP_URL, role: "eyadex_app", ids: systemUuidV7() });
});

afterAll(async () => {
  await db.close();
  await owner.end();
});

describe("PgSeatUsageReader (identity adapter for tenancy's port, eyadex_app)", () => {
  it("counts active memberships and only pending invitations that are still live", async () => {
    expect(await new PgSeatUsageReader(db).readSeatUsage(A, now)).toEqual({
      activeMemberships: 2,
      livePendingInvitations: 1,
    });
  });

  it("NEGATIVE: counts only the clinic in context — B's seats never add to A's", async () => {
    const reader = new PgSeatUsageReader(db);
    const [a, b] = [await reader.readSeatUsage(A, now), await reader.readSeatUsage(B, now)];
    expect(a).toEqual(b);
    expect(await reader.readSeatUsage(newId(), now)).toEqual({
      activeMemberships: 0,
      livePendingInvitations: 0,
    });
  });
});
