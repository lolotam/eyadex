import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Writable } from "node:stream";

import {
  createDatabase,
  createDispatcherOutbox,
  type Database,
  type DispatcherOutbox,
} from "@eyadex/db";
import { createLogger, type Logger } from "@eyadex/observability";
import { SecretSealer } from "@eyadex/secrets";

import { WORKER_LOG_EVENTS } from "../../shared/log-events.ts";
import { OutboxPoller } from "../../shared/outbox-poller.ts";
import { invitationDispatcher } from "../dispatch-invitation.ts";
import { INVITATION_EVENT_TYPES } from "../domain/invitation-event.ts";
import { PgInvitationStateReader } from "../persistence/pg-invitation-state-reader.ts";
import type { MailMessage, MailResult, MailSender } from "../ports/mail-sender.ts";

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
};

export const urls = () => ({
  owner: need("EYADEX_TEST_OWNER_URL"),
  app: need("EYADEX_TEST_APP_URL"),
  dispatcher: need("EYADEX_TEST_DISPATCHER_URL"),
});

export const APP_URL = "https://app.eyadex.test";

/** Owner-side setup and assertions through psql: the worker ships no driver of its own. */
export function owner(query: string): string {
  return execFileSync("psql", [urls().owner, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", query], {
    encoding: "utf8",
  }).trim();
}

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

export function ownerJson<T>(query: string): T {
  return JSON.parse(owner(`SELECT coalesce(json_agg(r), '[]') FROM (${query}) r`) || "[]") as T;
}

export interface EventRow {
  id: string;
  dispatched_at: string | null;
  failed_at: string | null;
  attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  payload: Record<string, unknown>;
}

export const eventRow = (id: string): EventRow =>
  ownerJson<EventRow[]>(
    `SELECT id, dispatched_at, failed_at, attempts, next_attempt_at, last_error, payload FROM outbox_events WHERE id = ${q(id)}`,
  )[0]!;

/** Parks events other suites left pending, so every claim here is one this suite wrote. */
export function parkLeftovers(): void {
  owner(
    "UPDATE outbox_events SET failed_at = now(), payload = payload - 'sealedToken' WHERE dispatched_at IS NULL AND failed_at IS NULL",
  );
}

export function seedClinic(language: "ar" | "en" = "ar"): { clinicId: string; roleId: string } {
  const clinicId = randomUUID();
  const roleId = randomUUID();
  const slug = `wk-${clinicId.slice(0, 8)}`;
  owner(`INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language, timezone, status,
           expires_at, max_users, max_branches, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(slug)}, 'عيادة النور', 'Al Noor <Clinic>', 'general', ${q(language)},
           'Asia/Kuwait', 'active', now() + interval '30 days', 10, 3, now(), now());
         INSERT INTO roles (clinic_id, id, system_key, name_ar, name_en, is_locked, is_active, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(roleId)}, 'doctor', 'طبيب', 'Doctor', false, true, now(), now());`);
  return { clinicId, roleId };
}

export const tokenHash = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export function seedInvitation(
  clinic: { clinicId: string; roleId: string },
  token: string,
  options: { status?: string; expiresAt?: Date; fullName?: string } = {},
): { invitationId: string; email: string; fullName: string } {
  const invitationId = randomUUID();
  const email = `invitee-${invitationId.slice(0, 8)}@example.test`;
  const fullName = options.fullName ?? "Sara Test";
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 7 * 86_400_000);
  owner(`INSERT INTO invitations (clinic_id, id, email, full_name, role_id, all_branches, status, expires_at,
           invited_by_user_id, token_hash, created_at)
         VALUES (${q(clinic.clinicId)}, ${q(invitationId)}, ${q(email)}, ${q(fullName)}, ${q(clinic.roleId)}, true,
           ${q(options.status ?? "pending")}, ${q(expiresAt.toISOString())}, ${q(randomUUID())},
           ${q(tokenHash(token))}, now())`);
  return { invitationId, email, fullName };
}

export function setTokenHash(clinicId: string, invitationId: string, token: string): void {
  owner(
    `UPDATE invitations SET token_hash = ${q(tokenHash(token))} WHERE clinic_id = ${q(clinicId)} AND id = ${q(invitationId)}`,
  );
}

let order = 0;

export function seedEvent(
  sealer: SecretSealer,
  type: string,
  clinicId: string,
  fields: Record<string, unknown>,
  token: string,
): string {
  const id = randomUUID();
  const payload = JSON.stringify({ ...fields, clinicId, sealedToken: sealer.seal(token, id) });
  // Strictly increasing created_at, so the claim order is the seed order.
  order += 1;
  owner(`INSERT INTO outbox_events (id, clinic_id, event_type, payload, created_at)
         VALUES (${q(id)}, ${q(clinicId)}, ${q(type)}, ${q(payload)}::jsonb,
                 now() - interval '1 hour' + ${order} * interval '1 millisecond')`);
  return id;
}

/** The only mock: records what would have been mailed. */
export class FakeMail implements MailSender {
  readonly sent: MailMessage[] = [];
  result: () => Promise<MailResult> = async () => ({ sent: true, provider: "resend", fallback: false });

  async send(message: MailMessage): Promise<MailResult> {
    const result = await this.result();
    if (result.sent) this.sent.push(message);
    return result;
  }
}

export const captureLogs = (): { lines: string[]; logger: Logger } => {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      lines.push(...String(chunk).split("\n").filter(Boolean));
      done();
    },
  });
  return { lines, logger: createLogger("info", { destination, events: WORKER_LOG_EVENTS }) };
};

export interface Harness {
  readonly app: Database;
  readonly outbox: DispatcherOutbox;
  readonly poller: OutboxPoller;
  readonly mail: FakeMail;
  readonly clock: { t: Date; now(): Date };
  readonly lines: string[];
  close(): Promise<void>;
}

export function harness(
  sealer: SecretSealer,
  mail = new FakeMail(),
  sender: MailSender = mail,
): Harness {
  const app = createDatabase({
    url: urls().app,
    role: "eyadex_app",
    ids: { newId: () => randomUUID() },
  });
  const outbox = createDispatcherOutbox({ url: urls().dispatcher });
  const clock = {
    t: new Date(),
    now() {
      return new Date(this.t);
    },
  };
  const { lines, logger } = captureLogs();
  const poller = new OutboxPoller({
    outbox,
    types: INVITATION_EVENT_TYPES,
    now: () => clock.now(),
    intervalMs: 20,
    logger,
    handle: invitationDispatcher({
      sealer,
      invitations: new PgInvitationStateReader(app),
      mail: sender,
      clock,
      appUrl: APP_URL,
      logger,
    }),
  });
  return {
    app,
    outbox,
    poller,
    mail,
    clock,
    lines,
    close: async () => {
      await Promise.all([app.close(), outbox.close()]);
    },
  };
}

/** Claims until nothing is ready. */
export async function drain(poller: OutboxPoller): Promise<void> {
  while (await poller.runOnce()) {
    // keep claiming
  }
}

export const userFields = (
  invite: { invitationId: string; email: string; fullName: string },
  language: "ar" | "en",
) => ({
  invitationId: invite.invitationId,
  email: invite.email,
  fullName: invite.fullName,
  language,
  clinicNameAr: "عيادة النور",
  clinicNameEn: "Al Noor <Clinic>",
  roleNameAr: "طبيب",
  roleNameEn: "Doctor",
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  reason: "invited",
});
