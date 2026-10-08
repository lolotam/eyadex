import { randomBytes, randomUUID } from "node:crypto";

import { createDatabase, type Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";
import { SecretSealer } from "@eyadex/secrets";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  captureLogs,
  FakeMail,
  owner,
  ownerJson,
  seedClinic,
  tokenHash,
  urls,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import { TEAM_INVITED } from "../../platform-invite-mail/domain/team-invite.ts";
import { teamInviteDispatcher } from "../../platform-invite-mail/handle-team-invited.ts";
import { PgTeamInviteStateReader } from "../../platform-invite-mail/pg-team-invite-state.ts";
import { EXPIRY_REMINDER } from "../domain/reminder-rules.ts";
import { expiryReminderDispatcher } from "../handle-expiry-reminder.ts";
import {
  PgDueClinicFinder,
  PgReminderLedger,
  PgReminderStateReader,
} from "../persistence/pg-reminder-store.ts";
import { ExpiryReminderScanner } from "../scan-expiry-reminders.ts";

// ADR-0020 on real PostgreSQL: the scan on eyadex_platform, the ledger and the event on eyadex_app under
// RLS, the send-time read, and the platform-team link check on eyadex_platform.
const q = (value: string) => `'${value.replace(/'/g, "''")}'`;
const ids = systemUuidV7();
let app: Database;
let platform: Database;

beforeAll(async () => {
  app = createDatabase({ url: urls().app, role: "eyadex_app", ids });
  const url = process.env["EYADEX_TEST_PLATFORM_URL"];
  if (!url) throw new Error("EYADEX_TEST_PLATFORM_URL is not set");
  platform = createDatabase({ url, role: "eyadex_platform", ids });
  // The worker's /health/ready pings this pool (ADR-0020): it must pass on the platform role.
  await platform.ping();
});

afterAll(async () => {
  await Promise.all([app.close(), platform.close()]);
});

function clinicExpiringIn(ms: number, status = "active") {
  const clinic = seedClinic("en");
  const at = new Date(Date.now() + ms).toISOString();
  owner(`UPDATE clinics SET expires_at = ${q(at)}, status = ${q(status)} WHERE id = ${q(clinic.clinicId)};
         INSERT INTO roles (clinic_id, id, system_key, name_ar, name_en, is_locked, is_active, created_at, updated_at)
         VALUES (${q(clinic.clinicId)}, ${q(randomUUID())}, 'clinic_admin', 'أدمن', 'Admin', true, true, now(), now())`);
  const adminRole = owner(
    `SELECT id FROM roles WHERE clinic_id = ${q(clinic.clinicId)} AND system_key = 'clinic_admin'`,
  );
  const email = `admin-${clinic.clinicId.slice(0, 8)}@example.test`;
  owner(`INSERT INTO memberships (clinic_id, id, user_id, full_name, email, role_id, all_branches, status,
           preferred_language, last_login_at, created_at, updated_at)
         VALUES (${q(clinic.clinicId)}, ${q(randomUUID())}, ${q(randomUUID())}, 'Admin', ${q(email)},
           ${q(adminRole)}, true, 'active', 'en', NULL, now(), now())`);
  return { ...clinic, email };
}

const scanner = () =>
  new ExpiryReminderScanner({
    finder: new PgDueClinicFinder(platform),
    ledger: new PgReminderLedger(app, ids),
    clock: { now: () => new Date() },
    logger: captureLogs().logger,
    intervalMs: 60_000,
  });

const reminderEvents = (clinicId: string) =>
  ownerJson<{ id: string; payload: Record<string, string>; attempts: number }[]>(
    `SELECT id, payload, attempts FROM outbox_events
     WHERE event_type = ${q(EXPIRY_REMINDER)} AND clinic_id = ${q(clinicId)}`,
  );

describe("expiry reminder (story 79)", () => {
  it("queues one reminder per clinic per expiry date, however often the scan runs", async () => {
    const due = clinicExpiringIn(3 * 86_400_000);
    const later = clinicExpiringIn(30 * 86_400_000);
    const suspended = clinicExpiringIn(86_400_000, "suspended");
    await scanner().runOnce();
    await scanner().runOnce();
    expect(reminderEvents(due.clinicId)).toHaveLength(1);
    expect(reminderEvents(later.clinicId)).toHaveLength(0);
    expect(reminderEvents(suspended.clinicId)).toHaveLength(0);
    // A renewal is a new expiry date: it earns one new reminder when it is due again.
    owner(
      `UPDATE clinics SET expires_at = now() + interval '5 days' WHERE id = ${q(due.clinicId)}`,
    );
    await scanner().runOnce();
    expect(reminderEvents(due.clinicId)).toHaveLength(2);
  });

  it("mails the clinic's active admin, and skips a clinic renewed after the scan", async () => {
    const clinic = clinicExpiringIn(2 * 86_400_000);
    await scanner().runOnce();
    const [event] = reminderEvents(clinic.clinicId);
    const mail = new FakeMail();
    const handle = expiryReminderDispatcher({
      state: new PgReminderStateReader(app),
      mail,
      clock: { now: () => new Date() },
      logger: captureLogs().logger,
    });
    const claimed = {
      id: event!.id,
      clinicId: clinic.clinicId,
      type: EXPIRY_REMINDER,
      payload: event!.payload,
      attempts: 0,
    } as never;
    expect(await handle(claimed)).toEqual({ kind: "dispatched" });
    expect(mail.sent.map((m) => m.to)).toEqual([clinic.email]);
    owner(
      `UPDATE clinics SET expires_at = now() + interval '90 days' WHERE id = ${q(clinic.clinicId)}`,
    );
    const again = new FakeMail();
    const renewed = expiryReminderDispatcher({
      state: new PgReminderStateReader(app),
      mail: again,
      clock: { now: () => new Date() },
      logger: captureLogs().logger,
    });
    expect(await renewed(claimed)).toEqual({ kind: "dispatched" });
    expect(again.sent).toHaveLength(0);
  });
});

describe("platform-team invitation mail", () => {
  it("mails only while the account is invited and the link's hash matches", async () => {
    const sealer = new SecretSealer(randomBytes(32).toString("base64"));
    const token = randomBytes(32).toString("base64url");
    const accountId = randomUUID();
    owner(`INSERT INTO platform_accounts (id, user_id, email, full_name, status, token_hash, token_expires_at,
             invited_by, joined_at, created_at, updated_at)
           VALUES (${q(accountId)}, NULL, ${q(`team-${accountId.slice(0, 8)}@example.test`)}, 'Team', 'invited',
             ${q(tokenHash(token))}, now() + interval '7 days', NULL, NULL, now(), now())`);
    const eventId = randomUUID();
    const event = {
      id: eventId,
      clinicId: null,
      type: TEAM_INVITED,
      attempts: 0,
      payload: {
        accountId,
        email: "team@example.test",
        fullName: "Team",
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        sealedToken: sealer.seal(token, eventId),
      },
    } as never;
    const mail = new FakeMail();
    const handle = teamInviteDispatcher({
      sealer,
      accounts: new PgTeamInviteStateReader(platform),
      mail,
      clock: { now: () => new Date() },
      platformUrl: "https://platform.eyadex.test",
      logger: captureLogs().logger,
    });
    expect(await handle(event)).toEqual({ kind: "dispatched" });
    expect(mail.sent).toHaveLength(1);
    owner(`UPDATE platform_accounts SET status = 'deactivated', token_hash = NULL, token_expires_at = NULL
           WHERE id = ${q(accountId)}`);
    expect(await handle(event)).toEqual({ kind: "dispatched" });
    expect(mail.sent).toHaveLength(1);
  });
});
