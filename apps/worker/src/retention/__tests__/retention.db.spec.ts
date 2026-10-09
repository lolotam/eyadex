import { randomUUID } from "node:crypto";

import { createDispatcherOutbox, DatabaseError, type DispatcherOutbox } from "@eyadex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  captureLogs,
  owner,
  ownerJson,
  seedClinic,
  urls,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import { RetentionPurgeJob } from "../purge-expired-rows.ts";

// ADR-0022 on real PostgreSQL: the purge runs on the dispatcher pool through the 0040 functions, across
// clinics, and the database alone decides what is old enough. Assertions name the rows seeded here.
const q = (value: string) => `'${value.replace(/'/g, "''")}'`;
let outbox: DispatcherOutbox;

beforeAll(() => {
  outbox = createDispatcherOutbox({ url: urls().dispatcher });
});

afterAll(async () => {
  await outbox.close();
});

type OutboxAge = { dispatched?: number; failed?: number; created: number; retrying?: boolean };

function event(clinicId: string | null, age: OutboxAge): string {
  const id = randomUUID();
  const ago = (days: number | undefined) =>
    days === undefined ? "NULL" : `now() - interval '${days} days'`;
  owner(`INSERT INTO outbox_events (id, clinic_id, event_type, payload, created_at, dispatched_at,
           attempts, next_attempt_at, last_error, failed_at)
         VALUES (${q(id)}, ${clinicId === null ? "NULL" : q(clinicId)}, 'clinic.user_invited', '{}',
           ${ago(age.created)}, ${ago(age.dispatched)}, ${age.retrying ? 2 : 0},
           ${age.retrying ? "now() - interval '1 day'" : "NULL"},
           ${age.retrying || age.failed !== undefined ? "'resend_500'" : "NULL"}, ${ago(age.failed)})`);
  return id;
}

function platformKey(days: number): string {
  const key = randomUUID();
  owner(`INSERT INTO idempotency_keys (scope, key, request_hash, response, created_at)
         VALUES ('retention-db', ${q(key)}, repeat('a', 64), '{}', now() - interval '${days} days')`);
  return key;
}

function clinicKey(clinicId: string, days: number): string {
  const id = randomUUID();
  owner(`INSERT INTO clinic_idempotency_keys (clinic_id, id, scope, key, request_hash, response, created_at)
         VALUES (${q(clinicId)}, ${q(id)}, 'branch:create', ${q(id)}, repeat('a', 64), '{}',
           now() - interval '${days} days')`);
  return id;
}

const present = (table: string, column: string, values: string[]): string[] =>
  ownerJson<{ v: string }[]>(
    `SELECT ${column}::text AS v FROM ${table} WHERE ${column}::text IN (${values.map(q).join(", ")})`,
  ).map((row) => row.v);

describe("the retention purge on PostgreSQL (ADR-0022, SQL 0040)", () => {
  it("deletes only rows past their period, in every clinic, and keeps pending and retrying events at any age", async () => {
    const a = seedClinic().clinicId;
    const b = seedClinic().clinicId;
    const keep = [
      event(a, { created: 29, dispatched: 29 }),
      event(b, { created: 90, failed: 89 }),
      event(null, { created: 32, failed: 31 }),
      event(a, { created: 400 }),
      event(b, { created: 400, retrying: true }),
    ];
    const drop = [
      event(a, { created: 31, dispatched: 31 }),
      event(null, { created: 31, dispatched: 31 }),
      event(b, { created: 92, failed: 91 }),
    ];
    const keptKeys = [platformKey(29)];
    const droppedKeys = [platformKey(31), platformKey(45)];
    const keptClinicKeys = [clinicKey(a, 29), clinicKey(b, 29)];
    const droppedClinicKeys = [clinicKey(a, 31), clinicKey(b, 31), clinicKey(b, 60)];

    // Batches of 2: every ledger needs more than one batch, so the loop is exercised for real.
    const job = new RetentionPurgeJob({
      purger: outbox,
      logger: captureLogs().logger,
      intervalMs: 60_000,
      batchSize: 2,
      maxBatches: 1000,
    });
    const run = await job.runOnce();
    expect(run.failed).toEqual([]);
    expect(run.backlog).toEqual([]);
    expect(run.purged.outbox).toBeGreaterThanOrEqual(drop.length);
    expect(run.purged.platformLedger).toBeGreaterThanOrEqual(droppedKeys.length);
    expect(run.purged.clinicLedger).toBeGreaterThanOrEqual(droppedClinicKeys.length);

    expect(present("outbox_events", "id", [...keep, ...drop]).sort()).toEqual([...keep].sort());
    expect(present("idempotency_keys", "key", [...keptKeys, ...droppedKeys])).toEqual(keptKeys);
    expect(
      present("clinic_idempotency_keys", "id", [...keptClinicKeys, ...droppedClinicKeys]).sort(),
    ).toEqual([...keptClinicKeys].sort());

    // Idempotent: the next run finds nothing left to delete.
    expect((await job.runOnce()).purged).toEqual({ outbox: 0, platformLedger: 0, clinicLedger: 0 });
  });

  it("NEGATIVE: the database refuses a batch over its cap, and an unknown ledger never reaches it", async () => {
    await expect(outbox.purgeExpired("outbox", 1001)).rejects.toBeInstanceOf(DatabaseError);
    await expect(outbox.purgeExpired("clinicLedger", 0)).rejects.toBeInstanceOf(DatabaseError);
    await expect(
      outbox.purgeExpired("audit_log" as unknown as "outbox", 10),
    ).rejects.toBeInstanceOf(TypeError);
    // The pool is still healthy after the refusals.
    await expect(outbox.ping()).resolves.toBeUndefined();
  });
});
