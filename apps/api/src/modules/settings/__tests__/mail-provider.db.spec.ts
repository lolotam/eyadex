import { randomBytes } from "node:crypto";

import { createDatabase, type Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";
import { SecretSealer } from "@eyadex/secrets";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiError } from "../../../shared/errors.ts";
import { getMailProvider } from "../queries/mail-provider.ts";
import { MailProviderChanges } from "../use-cases/mail-provider-changes.ts";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
};
const newId = systemUuidV7().newId;
const KEY = randomBytes(32).toString("base64");
const API_KEY = "re_recognisable_fake_api_key_123";
const PASSWORD = "recognisable-fake-smtp-password-456";

let owner: Sql;
let db: Database;
let changes: MailProviderChanges;

async function seedClinic(): Promise<string> {
  const id = newId();
  await owner`INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language,
      timezone, status, expires_at, max_users, max_branches, created_at, updated_at)
    VALUES (${id}, ${`mail-${id}`}, 'عيادة', 'Clinic', 'general', 'ar', 'Asia/Kuwait', 'active',
      now() + interval '30 days', 4, 3, now(), now())`;
  return id;
}

const resend = {
  kind: "resend" as const,
  apiKey: API_KEY,
  fromName: "Clinic",
  fromEmail: "clinic@example.test",
};
const smtp = {
  kind: "smtp" as const,
  host: "smtp.example.test",
  port: 587,
  user: "mailer",
  password: PASSWORD,
  fromName: "Clinic",
  fromEmail: "clinic@example.test",
  replyTo: "desk@example.test",
};

const auditText = async (clinicId: string) =>
  JSON.stringify(
    await owner`SELECT action, details FROM audit_log WHERE clinic_id = ${clinicId} ORDER BY created_at, id`,
  );

beforeAll(() => {
  owner = postgres(required("EYADEX_TEST_OWNER_URL"), { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: required("EYADEX_TEST_APP_URL"), role: "eyadex_app", ids: systemUuidV7() });
  changes = new MailProviderChanges({ db, clock: { now: () => new Date() }, ids: systemUuidV7(), sealKey: KEY });
});
afterAll(async () => {
  await Promise.all([db.close(), owner.end()]);
});

describe("clinic mail provider (ADR-0014, 7c-2a)", () => {
  it("never returns or audits the secret; seals it bound to the row id", async () => {
    const clinicId = await seedClinic();
    const actor = { clinicId, userId: newId() };
    const view = await changes.put(actor, resend, "k1");
    expect(view).toMatchObject({ kind: "resend", hasCredentials: true, verifiedAt: null });
    expect(JSON.stringify(view)).not.toContain(API_KEY);
    expect(JSON.stringify(await getMailProvider(db, clinicId))).not.toContain(API_KEY);
    await changes.put(actor, smtp, "k2");
    const audit = await auditText(clinicId);
    expect(audit).not.toContain(API_KEY);
    expect(audit).not.toContain(PASSWORD);
    const [row] = await owner`SELECT id, sealed_credentials FROM clinic_mail_providers WHERE clinic_id = ${clinicId}`;
    expect(row!.sealed_credentials).not.toContain(PASSWORD);
    expect(new SecretSealer(KEY).open(row!.sealed_credentials as string, row!.id as string)).toBe(PASSWORD);
    const keys = JSON.stringify(await owner`SELECT * FROM clinic_idempotency_keys WHERE clinic_id = ${clinicId}`);
    expect(keys).not.toContain(PASSWORD);
    expect(keys).not.toContain(API_KEY);
  });

  it("a replay returns the same view with one audit row; another body conflicts", async () => {
    const clinicId = await seedClinic();
    const actor = { clinicId, userId: newId() };
    const first = await changes.put(actor, resend, "same");
    expect(await changes.put(actor, resend, "same")).toEqual(first);
    const rows = await owner`SELECT 1 FROM audit_log WHERE clinic_id = ${clinicId}`;
    expect(rows).toHaveLength(1);
    await expect(changes.put(actor, { ...resend, apiKey: "re_other" }, "same")).rejects.toMatchObject({
      code: "idempotency_conflict",
    });
  });

  it("replacing keeps the row id and clears verification and failure state", async () => {
    const clinicId = await seedClinic();
    const actor = { clinicId, userId: newId() };
    await changes.put(actor, resend, "a");
    const [before] = await owner`SELECT id FROM clinic_mail_providers WHERE clinic_id = ${clinicId}`;
    await owner`UPDATE clinic_mail_providers SET verified_at = now(), last_error = 'x',
      consecutive_failures = 2, degraded_at = now() WHERE clinic_id = ${clinicId}`;
    await changes.put(actor, smtp, "b");
    const rows = await owner`SELECT id, verified_at, last_error, consecutive_failures, degraded_at
      FROM clinic_mail_providers WHERE clinic_id = ${clinicId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: before!.id,
      verified_at: null,
      last_error: null,
      consecutive_failures: 0,
      degraded_at: null,
    });
  });

  it("test request: 404 without a provider; one id-only event with a provider", async () => {
    const clinicId = await seedClinic();
    const actor = { clinicId, userId: newId() };
    await expect(changes.requestTest(actor, "t0")).rejects.toBeInstanceOf(ApiError);
    await changes.put(actor, smtp, "p");
    const [row] = await owner`SELECT id FROM clinic_mail_providers WHERE clinic_id = ${clinicId}`;
    await changes.requestTest(actor, "t1");
    await changes.requestTest(actor, "t1");
    const events = await owner`SELECT payload FROM outbox_events
      WHERE clinic_id = ${clinicId} AND event_type = 'clinic.mail_provider_test_requested'`;
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ clinicId, providerId: row!.id, actorUserId: actor.userId });
  });

  it("remove deletes the config row and audits it; another clinic's row is invisible", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    await changes.put({ clinicId: b, userId: newId() }, resend, "b");
    expect(await getMailProvider(db, a)).toBeNull();
    expect(await changes.remove({ clinicId: a, userId: newId() })).toBe(false);
    expect(await getMailProvider(db, b)).not.toBeNull();
    expect(await changes.remove({ clinicId: b, userId: newId() })).toBe(true);
    expect(await getMailProvider(db, b)).toBeNull();
    expect(await auditText(b)).toContain("clinic.mail_provider_removed");
  });
});
