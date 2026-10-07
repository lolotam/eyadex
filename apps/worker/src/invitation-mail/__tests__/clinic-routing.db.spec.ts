import { randomBytes, randomUUID } from "node:crypto";

import { createDatabase, createDispatcherOutbox } from "@eyadex/db";
import { SecretSealer } from "@eyadex/secrets";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PgProviderTestStore } from "../../mail-provider-test/persistence/pg-provider-test-store.ts";
import type { ClinicProviderCredentials } from "../../mail-provider-test/ports/clinic-sender-factory.ts";
import { OutboxPoller } from "../../shared/outbox-poller.ts";
import { invitationDispatcher } from "../dispatch-invitation.ts";
import { ADMIN_INVITED, INVITATION_EVENT_TYPES, USER_INVITED } from "../domain/invitation-event.ts";
import { RETRY_DELAYS_MS } from "../domain/retry-schedule.ts";
import { PgInvitationStateReader } from "../persistence/pg-invitation-state-reader.ts";
import {
  APP_URL,
  captureLogs,
  drain,
  eventRow,
  FakeMail,
  newToken,
  owner,
  ownerJson,
  parkLeftovers,
  seedClinic,
  seedEvent,
  seedInvitation,
  urls,
  userFields,
} from "./dispatch-fixtures.ts";

const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
const outboxSealer = new SecretSealer(randomBytes(32).toString("base64"));
const KEY = randomBytes(32).toString("base64");
const FAKE_SECRET = "re_fake_clinic_key_value";
const PLATFORM_FROM = "Eyadex <noreply@example.test>";

let app: ReturnType<typeof createDatabase>;
let outbox: ReturnType<typeof createDispatcherOutbox>;

beforeAll(() => {
  parkLeftovers();
  app = createDatabase({ url: urls().app, role: "eyadex_app", ids: { newId: randomUUID } });
  outbox = createDispatcherOutbox({ url: urls().dispatcher });
});
afterEach(parkLeftovers);
afterAll(async () => {
  await Promise.all([app.close(), outbox.close()]);
});

function make() {
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

interface ProviderOptions {
  verified?: boolean;
  degraded?: boolean;
  failures?: number;
  sealKey?: string;
}

function provider(clinicId: string, o: ProviderOptions = {}): string {
  const id = randomUUID();
  const sealed = new SecretSealer(o.sealKey ?? KEY).seal(FAKE_SECRET, id);
  owner(`INSERT INTO clinic_mail_providers (clinic_id, id, kind, from_name, from_email, reply_to,
           sealed_credentials, verified_at, degraded_at, consecutive_failures, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(id)}, 'resend', 'Clinic Desk', 'clinic@example.test',
           'desk@example.test', ${q(sealed)}, ${o.verified === false ? "NULL" : "now()"},
           ${o.degraded ? "now()" : "NULL"}, ${o.failures ?? 0}, now(), now())`);
  return id;
}

type ProviderState = {
  consecutive_failures: number;
  degraded_at: string | null;
  last_error: string | null;
};
const state = (id: string) =>
  ownerJson<ProviderState[]>(
    `SELECT consecutive_failures, degraded_at, last_error FROM clinic_mail_providers WHERE id = ${q(id)}`,
  )[0]!;
const degradedAudit = (clinicId: string) =>
  ownerJson<{ actor_user_id: string; details: Record<string, unknown> }[]>(
    `SELECT actor_user_id, details FROM audit_log WHERE clinic_id = ${q(clinicId)}
     AND action = 'clinic.mail_provider_degraded'`,
  );

function invite(type = USER_INVITED, clinic = seedClinic()) {
  const token = newToken();
  const inv = seedInvitation(clinic, token);
  const id = seedEvent(outboxSealer, type, clinic.clinicId, userFields(inv, "en"), token);
  return { clinic, inv, id };
}

describe("clinic provider routing (ADR-0014 7c-2b)", () => {
  it("a verified, healthy provider sends with the clinic from/reply-to; the platform gets nothing", async () => {
    const h = make();
    const { clinic, id } = invite();
    provider(clinic.clinicId);
    await drain(h.poller);
    expect(h.platform.sent).toHaveLength(0);
    expect(h.clinic.sent).toHaveLength(1);
    expect(h.clinic.sent[0]!.from).toEqual({ name: "Clinic Desk", address: "clinic@example.test" });
    expect(h.clinic.sent[0]!.replyTo).toBe("desk@example.test");
    expect(h.clinic.sent[0]!.idempotencyKey).toBe(id);
    expect(h.seen).toEqual([{ kind: "resend", apiKey: FAKE_SECRET }]);
    expect(eventRow(id).dispatched_at).not.toBeNull();
  });

  it.each([
    ["an unverified provider", (c: string) => provider(c, { verified: false })],
    ["no provider", () => undefined],
  ])("%s → the platform, message unchanged", async (_n, setup) => {
    const h = make();
    const { clinic } = invite();
    setup(clinic.clinicId);
    await drain(h.poller);
    expect(h.clinic.sent).toHaveLength(0);
    expect(h.platform.sent).toHaveLength(1);
    expect(h.platform.sent[0]!.from).toBeUndefined();
    expect(h.platform.sent[0]!.replyTo).toBeUndefined();
  });

  it("clinic.admin_invited uses the platform even with a healthy clinic provider", async () => {
    const h = make();
    const { clinic } = invite(ADMIN_INVITED);
    provider(clinic.clinicId);
    await drain(h.poller);
    expect(h.clinic.sent).toHaveLength(0);
    expect(h.platform.sent).toHaveLength(1);
  });

  it("never uses clinic B's provider for clinic A's invitation", async () => {
    const h = make();
    const other = seedClinic();
    provider(other.clinicId);
    invite();
    await drain(h.poller);
    expect(h.clinic.sent).toHaveLength(0);
    expect(h.platform.sent).toHaveLength(1);
  });
});

describe("clinic provider degradation", () => {
  it("the third definitive failure degrades, audits with the inviter, and the retry goes via the platform", async () => {
    const h = make();
    const { clinic, inv, id } = invite();
    const pid = provider(clinic.clinicId, { failures: 1 });
    h.clinic.result = async () => ({ sent: false, error: "resend_503" });
    await drain(h.poller);
    expect(state(pid)).toMatchObject({ consecutive_failures: 2, degraded_at: null });
    h.clock.t = new Date(h.clock.t.getTime() + RETRY_DELAYS_MS[0]!);
    await drain(h.poller);
    const s = state(pid);
    expect(s.consecutive_failures).toBe(3);
    expect(s.degraded_at).not.toBeNull();
    expect(s.last_error).toBe("resend_503");
    expect(eventRow(id).last_error).toBe("resend_503");
    expect(h.platform.sent).toHaveLength(0);
    const inviter = owner(
      `SELECT invited_by_user_id FROM invitations WHERE id = ${q(inv.invitationId)}`,
    );
    const audit = degradedAudit(clinic.clinicId);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actor_user_id).toBe(inviter);
    expect(audit[0]!.details).toEqual({
      reason: "consecutive_failures",
      failures: 3,
      lastError: "resend_503",
      providerVersion: 1,
    });
    expect(JSON.stringify(audit)).not.toContain("example.test");

    h.clock.t = new Date(h.clock.t.getTime() + RETRY_DELAYS_MS[1]!);
    await drain(h.poller);
    expect(h.platform.sent).toHaveLength(1);
    expect(h.platform.sent[0]!.from).toEqual({
      name: "Clinic Desk",
      address: "noreply@example.test",
    });
    expect(h.platform.sent[0]!.replyTo).toBe("desk@example.test");
    expect(eventRow(id).dispatched_at).not.toBeNull();
  });

  it.each(["resend_timeout", "smtp_timeout"])(
    "%s retries with the clinic provider and leaves the counter alone",
    async (error) => {
      const h = make();
      const { clinic, id } = invite();
      const pid = provider(clinic.clinicId, { failures: 2 });
      h.clinic.result = async () => ({ sent: false, error });
      await drain(h.poller);
      expect(state(pid)).toMatchObject({ consecutive_failures: 2, degraded_at: null });
      expect(eventRow(id).next_attempt_at).not.toBeNull();
      expect(h.platform.sent).toHaveLength(0);
    },
  );

  it("a success resets a counter of 2 to 0", async () => {
    const h = make();
    const { clinic } = invite();
    const pid = provider(clinic.clinicId, { failures: 2 });
    await drain(h.poller);
    expect(state(pid).consecutive_failures).toBe(0);
  });

  it("a wrong seal key is seal_unreadable and counts as definitive", async () => {
    const h = make();
    const { clinic, id } = invite();
    const pid = provider(clinic.clinicId, { sealKey: randomBytes(32).toString("base64") });
    await drain(h.poller);
    expect(h.seen).toHaveLength(0);
    expect(state(pid)).toMatchObject({ consecutive_failures: 1, last_error: "seal_unreadable" });
    expect(eventRow(id).last_error).toBe("seal_unreadable");
  });

  it("a successful test send clears degraded_at and the counter", async () => {
    const clinic = seedClinic();
    const pid = provider(clinic.clinicId, { degraded: true, failures: 3 });
    await new PgProviderTestStore(app).withProvider(
      clinic.clinicId,
      pid,
      randomUUID(),
      async () => ({
        ok: true,
        at: new Date(),
      }),
    );
    expect(state(pid)).toMatchObject({
      consecutive_failures: 0,
      degraded_at: null,
      last_error: null,
    });
  });

  it("keeps the invitation row locked while the clinic sender sends", async () => {
    const h = make();
    const { clinic, inv } = invite();
    provider(clinic.clinicId);
    let during = "";
    h.clinic.result = async () => {
      try {
        owner(`SET lock_timeout = '300ms';
               UPDATE invitations SET status = 'cancelled' WHERE id = ${q(inv.invitationId)}`);
        during = "committed";
      } catch (error) {
        during = String((error as { stderr?: unknown }).stderr ?? error);
      }
      return { sent: true, provider: "resend", fallback: false };
    };
    await drain(h.poller);
    expect(during).toMatch(/lock timeout/);
    expect(h.clinic.sent).toHaveLength(1);
  });
});
