import { randomBytes, randomUUID } from "node:crypto";

import type { Database, DispatcherOutbox } from "@eyadex/db";
import { SecretSealer } from "@eyadex/secrets";

import type { ClinicProviderCredentials } from "../../mail-provider-test/ports/clinic-sender-factory.ts";
import { OutboxPoller } from "../../shared/outbox-poller.ts";
import { invitationDispatcher } from "../dispatch-invitation.ts";
import { INVITATION_EVENT_TYPES, USER_INVITED } from "../domain/invitation-event.ts";
import { PgInvitationStateReader } from "../persistence/pg-invitation-state-reader.ts";
import {
  APP_URL,
  captureLogs,
  FakeMail,
  newToken,
  owner,
  ownerJson,
  seedClinic,
  seedEvent,
  seedInvitation,
  userFields,
} from "./dispatch-fixtures.ts";

export const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
export const outboxSealer = new SecretSealer(randomBytes(32).toString("base64"));
export const KEY = randomBytes(32).toString("base64");
export const FAKE_SECRET = "re_fake_clinic_key_value";
export const PLATFORM_FROM = "Eyadex <noreply@example.test>";

/** A poller whose platform and clinic senders are fakes, on the given pools. */
export function routingHarness(app: Database, outbox: DispatcherOutbox) {
  const platform = new FakeMail();
  const clinic = new FakeMail();
  const seen: ClinicProviderCredentials[] = [];
  const clock = { t: new Date(), now: () => new Date(clock.t) };
  const { lines, logger } = captureLogs();
  const poller = new OutboxPoller({
    outbox,
    types: INVITATION_EVENT_TYPES,
    now: () => clock.now(),
    intervalMs: 20,
    logger,
    handle: invitationDispatcher({
      sealer: outboxSealer,
      invitations: new PgInvitationStateReader(app, { newId: randomUUID }),
      mail: platform,
      clock,
      appUrl: APP_URL,
      logger,
      clinicMail: {
        sealer: new SecretSealer(KEY),
        senders: {
          open: async (c) => {
            seen.push(c);
            return { sender: clinic, close: () => undefined };
          },
        },
        platformFrom: PLATFORM_FROM,
      },
    }),
  });
  return { platform, clinic, seen, clock, lines, poller };
}

export interface ProviderOptions {
  verified?: boolean;
  degraded?: boolean;
  failures?: number;
  sealKey?: string;
}

export function provider(clinicId: string, o: ProviderOptions = {}): string {
  const id = randomUUID();
  const sealed = new SecretSealer(o.sealKey ?? KEY).seal(FAKE_SECRET, id);
  owner(`INSERT INTO clinic_mail_providers (clinic_id, id, kind, from_name, from_email, reply_to,
           sealed_credentials, verified_at, degraded_at, consecutive_failures, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(id)}, 'resend', 'Clinic Desk', 'clinic@example.test',
           'desk@example.test', ${q(sealed)}, ${o.verified === false ? "NULL" : "now()"},
           ${o.degraded ? "now()" : "NULL"}, ${o.failures ?? 0}, now(), now())`);
  return id;
}

export type ProviderState = {
  consecutive_failures: number;
  degraded_at: string | null;
  last_error: string | null;
};
export const state = (id: string) =>
  ownerJson<ProviderState[]>(
    `SELECT consecutive_failures, degraded_at, last_error FROM clinic_mail_providers WHERE id = ${q(id)}`,
  )[0]!;
export const degradedAudit = (clinicId: string) =>
  ownerJson<{ actor_user_id: string; details: Record<string, unknown> }[]>(
    `SELECT actor_user_id, details FROM audit_log WHERE clinic_id = ${q(clinicId)}
     AND action = 'clinic.mail_provider_degraded'`,
  );

export function invite(type = USER_INVITED, clinic = seedClinic()) {
  const token = newToken();
  const inv = seedInvitation(clinic, token);
  const id = seedEvent(outboxSealer, type, clinic.clinicId, userFields(inv, "en"), token);
  return { clinic, inv, id };
}
