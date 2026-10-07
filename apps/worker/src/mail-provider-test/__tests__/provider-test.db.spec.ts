import { randomBytes, randomUUID } from "node:crypto";

import { createDatabase, createDispatcherOutbox } from "@eyadex/db";
import { SecretSealer } from "@eyadex/secrets";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  captureLogs,
  drain,
  eventRow,
  FakeMail,
  owner,
  ownerJson,
  parkLeftovers,
  seedClinic,
  urls,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import { SmtpMailSender, type SmtpTransport } from "../../invitation-mail/mail/smtp-mail-sender.ts";
import type { MailSender } from "../../invitation-mail/ports/mail-sender.ts";
import { routeEvents } from "../../shared/event-router.ts";
import { OutboxPoller } from "../../shared/outbox-poller.ts";
import { MAIL_PROVIDER_TEST_REQUESTED } from "../domain/test-event.ts";
import { mailProviderTestHandler } from "../handle-test-requested.ts";
import { PgProviderTestStore } from "../persistence/pg-provider-test-store.ts";
import type { ClinicProviderCredentials } from "../ports/clinic-sender-factory.ts";

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const KEY = randomBytes(32).toString("base64");
const FAKE_SECRET = "re_fake_provider_secret_value";

let app: ReturnType<typeof createDatabase>;
let outbox: ReturnType<typeof createDispatcherOutbox>;

beforeAll(() => {
  parkLeftovers();
  app = createDatabase({ url: urls().app, role: "eyadex_app", ids: { newId: randomUUID } });
  outbox = createDispatcherOutbox({ url: urls().dispatcher });
});
afterAll(async () => {
  await Promise.all([app.close(), outbox.close()]);
});

function harness(sender: MailSender, sealKey = KEY) {
  const seen: ClinicProviderCredentials[] = [];
  const { lines, logger } = captureLogs();
  const route = routeEvents({
    [MAIL_PROVIDER_TEST_REQUESTED]: mailProviderTestHandler({
      sealer: new SecretSealer(sealKey),
      store: new PgProviderTestStore(app),
      senders: {
        open: (c) => {
          seen.push(c);
          return { sender, close: () => undefined };
        },
      },
      clock: { now: () => new Date() },
      logger,
    }),
  });
  const poller = new OutboxPoller({
    outbox,
    types: route.types,
    handle: route.handle,
    now: () => new Date(),
    intervalMs: 20,
    logger,
  });
  return { poller, seen, lines };
}

function member(clinicId: string, roleId: string, email: string): string {
  const userId = randomUUID();
  owner(`INSERT INTO memberships VALUES (${q(clinicId)}, ${q(randomUUID())}, ${q(userId)}, 'n',
         ${q(email)}, ${q(roleId)}, true, 'active', 'ar', null, now(), now())`);
  return userId;
}

function provider(clinicId: string, kind: "resend" | "smtp" = "resend"): string {
  const id = randomUUID();
  const sealed = new SecretSealer(KEY).seal(FAKE_SECRET, id);
  const smtp = kind === "smtp" ? "'smtp.example.test', 587, 'mailer'" : "null, null, null";
  owner(`INSERT INTO clinic_mail_providers (clinic_id, id, kind, from_name, from_email, reply_to,
           smtp_host, smtp_port, smtp_user, sealed_credentials, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(id)}, ${q(kind)}, 'Clinic', 'clinic@example.test',
           'desk@example.test', ${smtp}, ${q(sealed)}, now() - interval '2 hours',
           now() - interval '2 hours')`);
  return id;
}

function event(payload: Record<string, unknown>, clinicId: string): string {
  const id = randomUUID();
  owner(`INSERT INTO outbox_events (id, clinic_id, event_type, payload, created_at)
         VALUES (${q(id)}, ${q(clinicId)}, ${q(MAIL_PROVIDER_TEST_REQUESTED)},
           ${q(JSON.stringify(payload))}::jsonb, now() - interval '1 hour')`);
  return id;
}

const row = (clinicId: string) =>
  ownerJson<{ verified_at: string | null; last_error: string | null }[]>(
    `SELECT verified_at, last_error FROM clinic_mail_providers WHERE clinic_id = ${q(clinicId)}`,
  )[0]!;

function setup(kind: "resend" | "smtp" = "resend") {
  const { clinicId, roleId } = seedClinic();
  member(clinicId, roleId, "other@example.test");
  const actor = member(clinicId, roleId, "admin@example.test");
  const providerId = provider(clinicId, kind);
  const eventId = event({ clinicId, providerId, actorUserId: actor }, clinicId);
  return { clinicId, providerId, eventId };
}

describe("clinic mail provider test send (ADR-0014, 7c-2a)", () => {
  it("mails only the acting admin from the clinic's sender and sets verified_at", async () => {
    const mail = new FakeMail();
    const h = harness(mail);
    const { clinicId, eventId } = setup();
    await drain(h.poller);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe("admin@example.test");
    expect(mail.sent[0]!.from).toEqual({ name: "Clinic", address: "clinic@example.test" });
    expect(mail.sent[0]!.replyTo).toBe("desk@example.test");
    expect(mail.sent[0]!.idempotencyKey).toBe(eventId);
    expect(h.seen[0]).toEqual({ kind: "resend", apiKey: FAKE_SECRET });
    expect(row(clinicId)).toMatchObject({ last_error: null });
    expect(row(clinicId).verified_at).not.toBeNull();
    expect(eventRow(eventId).dispatched_at).not.toBeNull();
    expect(h.lines.join("\n")).not.toContain(FAKE_SECRET);
    expect(h.lines.join("\n")).not.toContain("admin@example.test");
  });

  it("records seal_unreadable when the key is wrong, leaving verified_at null", async () => {
    const mail = new FakeMail();
    const h = harness(mail, randomBytes(32).toString("base64"));
    const { clinicId, eventId } = setup();
    await drain(h.poller);
    expect(mail.sent).toHaveLength(0);
    expect(row(clinicId)).toEqual({ verified_at: null, last_error: "seal_unreadable" });
    expect(eventRow(eventId).dispatched_at).not.toBeNull();
  });

  it("stores a short SMTP code, never the server's text", async () => {
    const transport: SmtpTransport = {
      sendMail: async () => {
        throw Object.assign(new Error("535 secret-server-text for admin@example.test"), {
          code: "EAUTH",
          responseCode: 535,
        });
      },
      close: () => undefined,
    };
    const h = harness(new SmtpMailSender(transport, "unused@invalid"));
    const { clinicId } = setup("smtp");
    await drain(h.poller);
    const { last_error, verified_at } = row(clinicId);
    expect(verified_at).toBeNull();
    expect(last_error).toMatch(/^smtp_/);
    expect(last_error).not.toContain("secret-server-text");
    expect(h.seen[0]).toMatchObject({
      kind: "smtp",
      host: "smtp.example.test",
      password: FAKE_SECRET,
    });
  });

  it("skips without writing when the provider was replaced after the request", async () => {
    const mail = new FakeMail();
    const h = harness(mail);
    const { clinicId, eventId } = setup();
    owner(`UPDATE clinic_mail_providers SET updated_at = now() WHERE clinic_id = ${q(clinicId)}`);
    await drain(h.poller);
    expect(mail.sent).toHaveLength(0);
    expect(row(clinicId)).toEqual({ verified_at: null, last_error: null });
    expect(eventRow(eventId).dispatched_at).not.toBeNull();
  });

  it("fails a malformed payload or one for another clinic", async () => {
    const h = harness(new FakeMail());
    const { clinicId, providerId } = setup();
    const bad = event({ clinicId, providerId }, clinicId);
    const other = event(
      { clinicId: randomUUID(), providerId, actorUserId: randomUUID() },
      clinicId,
    );
    await drain(h.poller);
    for (const id of [bad, other]) {
      expect(eventRow(id)).toMatchObject({ dispatched_at: null, last_error: "invalid_payload" });
      expect(eventRow(id).failed_at).not.toBeNull();
    }
  });
});
