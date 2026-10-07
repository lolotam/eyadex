import { randomBytes, randomUUID } from "node:crypto";

import { createDatabase, createDispatcherOutbox } from "@eyadex/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PgProviderTestStore } from "../../mail-provider-test/persistence/pg-provider-test-store.ts";
import { ADMIN_INVITED } from "../domain/invitation-event.ts";
import { RETRY_DELAYS_MS } from "../domain/retry-schedule.ts";
import {
  degradedAudit,
  FAKE_SECRET,
  invite,
  provider,
  q,
  routingHarness,
  state,
} from "./clinic-routing-fixtures.ts";
import { drain, eventRow, owner, parkLeftovers, seedClinic, urls } from "./dispatch-fixtures.ts";

let app: ReturnType<typeof createDatabase>;
let outbox: ReturnType<typeof createDispatcherOutbox>;
const make = () => routingHarness(app, outbox);

beforeAll(() => {
  parkLeftovers();
  app = createDatabase({ url: urls().app, role: "eyadex_app", ids: { newId: randomUUID } });
  outbox = createDispatcherOutbox({ url: urls().dispatcher });
});
afterEach(parkLeftovers);
afterAll(async () => {
  await Promise.all([app.close(), outbox.close()]);
});

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

  it("degrading on the event's last attempt still leaves it one try through the platform", async () => {
    const h = make();
    const { clinic, id } = invite();
    const pid = provider(clinic.clinicId, { failures: 2 });
    // Ambiguous failures already used four of the five attempts.
    owner(`UPDATE outbox_events SET attempts = 4 WHERE id = ${q(id)}`);
    h.clinic.result = async () => ({ sent: false, error: "resend_401:validation_error" });
    await drain(h.poller);
    expect(state(pid).degraded_at).not.toBeNull();
    expect(eventRow(id).failed_at).toBeNull();
    await drain(h.poller);
    expect(h.platform.sent).toHaveLength(1);
    expect(eventRow(id).dispatched_at).not.toBeNull();
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
