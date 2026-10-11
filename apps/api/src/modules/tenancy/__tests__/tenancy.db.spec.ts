import { createDatabase, type Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PgBranchReader } from "../persistence/pg-branch-reader.ts";
import { PgClinicReader } from "../persistence/pg-clinic-reader.ts";
import type { SeatUsageReader } from "../ports/seat-usage-reader.ts";
import { getClinicAccessState } from "../queries/clinic-access-state.ts";
import { listClinicBranches } from "../queries/clinic-branches.ts";

// Same pattern as packages/db/src/__tests__/test-database.ts: owner for fixtures, eyadex_app for the code.
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

interface Fixture {
  clinicId: string;
  branchIds: { activeB: string; activeA: string; inactive: string };
}

const expiresAt = new Date("2030-01-01T00:00:00.000Z");
const clock = { now: () => new Date("2029-12-31T00:00:00.000Z") };
// Seat counting belongs to identity (PgSeatUsageReader, tested there); tenancy only consumes the port.
const seats: SeatUsageReader = {
  readSeatUsage: () => Promise.resolve({ activeMemberships: 1, livePendingInvitations: 1 }),
};

async function seedClinic(owner: Sql, status: "active" | "suspended"): Promise<Fixture> {
  const clinicId = newId();
  const branchIds = { activeB: newId(), activeA: newId(), inactive: newId() };
  await owner.begin(async (tx) => {
    await tx`INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language,
        timezone, status, expires_at, max_users, max_branches, created_at, updated_at)
      VALUES (${clinicId}, ${`tenancy-${clinicId}`}, 'عيادة', 'Clinic', 'general', 'ar',
        'Asia/Kuwait', ${status}, ${expiresAt}, 4, 3, now(), now())`;
    await tx`INSERT INTO clinic_features (clinic_id, id, module, enabled, updated_at)
      VALUES (${clinicId}, ${newId()}, 'patients', true, now())`;
    for (const [id, nameEn, active] of [
      [branchIds.activeB, "Beta", true],
      [branchIds.inactive, "Alpha closed", false],
      [branchIds.activeA, "Alpha", true],
    ] as const) {
      await tx`INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
        VALUES (${clinicId}, ${id}, ${`فرع ${nameEn}`}, ${nameEn}, ${active}, now(), now())`;
    }
  });
  return { clinicId, branchIds };
}

let owner: Sql;
let db: Database;
let A: Fixture;
let B: Fixture;

beforeAll(async () => {
  owner = postgres(OWNER_URL, { max: 1, onnotice: () => undefined });
  A = await seedClinic(owner, "active");
  B = await seedClinic(owner, "suspended");
  db = createDatabase({ url: APP_URL, role: "eyadex_app", ids: systemUuidV7() });
});

afterAll(async () => {
  await db.close();
  await owner.end();
});

describe("clinic access state (eyadex_app)", () => {
  it("computes access, usage and flags from the clinic's own rows", async () => {
    const state = await getClinicAccessState(new PgClinicReader(db), seats, clock, A.clinicId);
    expect(state).toEqual({
      clinicId: A.clinicId,
      status: "active",
      expiresAt,
      access: "allowed",
      users: { used: 2, max: 4 },
      branches: { used: 2, max: 3 },
      modules: { patients: true, appointments: false, medical: false },
    });
  });

  it("reports a suspended clinic", async () => {
    const state = await getClinicAccessState(new PgClinicReader(db), seats, clock, B.clinicId);
    expect(state?.access).toBe("suspended");
  });

  it("returns null for an unknown clinic", async () => {
    expect(await getClinicAccessState(new PgClinicReader(db), seats, clock, newId())).toBeNull();
  });
});

describe("clinic branches (eyadex_app)", () => {
  it("lists active first, then by name in the requested language", async () => {
    const branches = await listClinicBranches(new PgBranchReader(db), A.clinicId, "en");
    expect(branches.map((branch) => branch.id)).toEqual([
      A.branchIds.activeA,
      A.branchIds.activeB,
      A.branchIds.inactive,
    ]);
  });

  it("NEGATIVE: clinic A's context never sees clinic B's branches", async () => {
    const seen = await listClinicBranches(new PgBranchReader(db), A.clinicId, "ar");
    const ids = new Set(seen.map((branch) => branch.id));
    for (const id of Object.values(B.branchIds)) expect(ids.has(id)).toBe(false);
    // The reader's own query shape, run in A's context but filtered on B: RLS returns zero rows.
    const crossed = await db.withTenant(A.clinicId, (tx) =>
      tx.execute<{ id: string }>(sql`SELECT id FROM branches WHERE clinic_id = ${B.clinicId}`),
    );
    expect(crossed).toEqual([]);
  });
});
