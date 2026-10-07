import { randomBytes } from "node:crypto";

import { SecretSealer } from "@eyadex/secrets";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ADMIN_INVITED, USER_INVITED } from "../domain/invitation-event.ts";
import { RETRY_DELAYS_MS } from "../domain/retry-schedule.ts";
import {
  APP_URL,
  drain,
  eventRow,
  FakeMail,
  harness,
  newToken,
  owner,
  parkLeftovers,
  seedClinic,
  seedEvent,
  seedInvitation,
  setTokenHash,
  userFields,
  type Harness,
} from "./dispatch-fixtures.ts";

const sealer = new SecretSealer(randomBytes(32).toString("base64"));
const open: Harness[] = [];
const make = (mail?: FakeMail) => {
  const h = harness(sealer, mail);
  open.push(h);
  return h;
};

beforeAll(parkLeftovers);
afterEach(parkLeftovers);
afterAll(async () => {
  await Promise.all(open.map((h) => h.close()));
});

describe("send-time check (ADR-0012 §8)", () => {
  it("sends a fresh invite once, in its language, with the link and an escaped name", async () => {
    const h = make();
    const clinic = seedClinic("ar");
    const token = newToken();
    const invite = seedInvitation(clinic, token, { fullName: `<b>Sara & "Co"</b>` });
    const id = seedEvent(sealer, USER_INVITED, clinic.clinicId, userFields(invite, "ar"), token);

    await drain(h.poller);
    await drain(h.poller);

    expect(h.mail.sent).toHaveLength(1);
    const mail = h.mail.sent[0]!;
    expect(mail.to).toBe(invite.email);
    expect(mail.idempotencyKey).toBe(id);
    expect(mail.html).toContain('dir="rtl"');
    expect(mail.html).toContain("طبيب");
    expect(mail.html).toContain(`${APP_URL}/invite/${token}`);
    expect(mail.text).toContain(`${APP_URL}/invite/${token}`);
    expect(mail.html).toContain("&lt;b&gt;Sara &amp; &quot;Co&quot;&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>Sara");
    expect(mail.html).toContain("Eyadex");
    expect(mail.html).not.toContain("كاشير");
    const row = eventRow(id);
    expect(row.dispatched_at).not.toBeNull();
    expect(row.payload).not.toHaveProperty("sealedToken");
  });

  it("sends the first admin's invite in English with no role line", async () => {
    const h = make();
    const clinic = seedClinic("en");
    const token = newToken();
    const invite = seedInvitation(clinic, token);
    const { roleNameAr: _a, roleNameEn: _e, reason: _r, ...fields } = userFields(invite, "en");
    const id = seedEvent(sealer, ADMIN_INVITED, clinic.clinicId, fields, token);
    await drain(h.poller);
    expect(h.mail.sent).toHaveLength(1);
    expect(h.mail.sent[0]!.html).toContain('dir="ltr"');
    expect(h.mail.sent[0]!.html).toContain("Al Noor &lt;Clinic&gt;");
    expect(h.mail.sent[0]!.subject).toContain("Al Noor <Clinic>");
    expect(eventRow(id).payload).not.toHaveProperty("sealedToken");
  });

  it.each([
    ["cancelled", { status: "cancelled" }],
    ["accepted", { status: "accepted" }],
    ["expired", { expiresAt: new Date(Date.now() - 60_000) }],
  ])("skips a %s invitation, mails nothing and scrubs the token", async (_name, options) => {
    const h = make();
    const clinic = seedClinic();
    const token = newToken();
    const invite = seedInvitation(clinic, token, options);
    const id = seedEvent(sealer, USER_INVITED, clinic.clinicId, userFields(invite, "ar"), token);
    await drain(h.poller);
    expect(h.mail.sent).toHaveLength(0);
    const row = eventRow(id);
    expect(row.dispatched_at).not.toBeNull();
    expect(row.payload).not.toHaveProperty("sealedToken");
  });

  it("after a resend mails only the new event; after a copy-link mails nothing", async () => {
    const h = make();
    const clinic = seedClinic();
    const first = newToken();
    const invite = seedInvitation(clinic, first);
    const oldEvent = seedEvent(
      sealer,
      USER_INVITED,
      clinic.clinicId,
      userFields(invite, "ar"),
      first,
    );
    const resent = newToken();
    setTokenHash(clinic.clinicId, invite.invitationId, resent);
    const newEvent = seedEvent(
      sealer,
      USER_INVITED,
      clinic.clinicId,
      userFields(invite, "ar"),
      resent,
    );

    const copied = seedInvitation(clinic, newToken());
    const copiedFirst = newToken();
    setTokenHash(clinic.clinicId, copied.invitationId, copiedFirst);
    const copiedEvent = seedEvent(
      sealer,
      USER_INVITED,
      clinic.clinicId,
      userFields(copied, "ar"),
      newToken(),
    );

    await drain(h.poller);
    expect(h.mail.sent.map((m) => m.idempotencyKey)).toEqual([newEvent]);
    expect(h.mail.sent[0]!.html).toContain(resent);
    for (const id of [oldEvent, newEvent, copiedEvent]) {
      expect(eventRow(id).payload).not.toHaveProperty("sealedToken");
      expect(eventRow(id).dispatched_at).not.toBeNull();
    }
  });

  it("leaves an event type it does not handle untouched", async () => {
    const h = make();
    const clinic = seedClinic();
    const id = seedEvent(sealer, "clinic.something_else", clinic.clinicId, {}, newToken());
    await drain(h.poller);
    const row = eventRow(id);
    expect(row.dispatched_at).toBeNull();
    expect(row.attempts).toBe(0);
    expect(row.payload).toHaveProperty("sealedToken");
  });
});

describe("failures", () => {
  it("retries on the backoff schedule and gives up after the fifth failure, token scrubbed", async () => {
    const mail = new FakeMail();
    mail.result = async () => ({ sent: false, error: "resend_500" });
    const h = make(mail);
    const clinic = seedClinic();
    const token = newToken();
    const invite = seedInvitation(clinic, token);
    const id = seedEvent(sealer, USER_INVITED, clinic.clinicId, userFields(invite, "ar"), token);

    for (let failure = 1; failure <= 4; failure++) {
      expect(await h.poller.runOnce()).toBe(true);
      const row = eventRow(id);
      expect(row.attempts).toBe(failure);
      expect(row.last_error).toBe("resend_500");
      expect(new Date(row.next_attempt_at!).getTime()).toBe(
        h.clock.t.getTime() + RETRY_DELAYS_MS[failure - 1]!,
      );
      expect(row.payload).toHaveProperty("sealedToken");
      // Not due yet: nothing is claimed one millisecond early.
      h.clock.t = new Date(h.clock.t.getTime() + RETRY_DELAYS_MS[failure - 1]! - 1);
      expect(await h.poller.runOnce()).toBe(false);
      h.clock.t = new Date(h.clock.t.getTime() + 1);
    }
    expect(await h.poller.runOnce()).toBe(true);
    const row = eventRow(id);
    expect(row.attempts).toBe(5);
    expect(row.failed_at).not.toBeNull();
    expect(row.payload).not.toHaveProperty("sealedToken");
    expect(row.last_error).not.toContain(token);
    expect(await h.poller.runOnce()).toBe(false);
  });

  it("writes neither the token, the link, the address nor the name to any log line", async () => {
    const mail = new FakeMail();
    let calls = 0;
    mail.result = async () =>
      ++calls === 1 ? { sent: false, error: "resend_429" } : { sent: true };
    const h = make(mail);
    const clinic = seedClinic();
    const token = newToken();
    const invite = seedInvitation(clinic, token, { fullName: "Unique Person Name" });
    const id = seedEvent(sealer, USER_INVITED, clinic.clinicId, userFields(invite, "en"), token);
    await h.poller.runOnce();
    h.clock.t = new Date(h.clock.t.getTime() + RETRY_DELAYS_MS[0]!);
    await h.poller.runOnce();
    expect(h.mail.sent).toHaveLength(1);
    const all = h.lines.join("\n");
    expect(all).toContain(id);
    for (const secret of [token, `${APP_URL}/invite`, invite.email, "Unique Person Name"]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe("concurrency and shutdown", () => {
  it("two dispatchers running at once send each event exactly once", async () => {
    const slow = () => {
      const mail = new FakeMail();
      mail.result = async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { sent: true };
      };
      return mail;
    };
    const a = make(slow());
    const b = make(slow());
    const clinic = seedClinic();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const token = newToken();
      const invite = seedInvitation(clinic, token);
      ids.push(seedEvent(sealer, USER_INVITED, clinic.clinicId, userFields(invite, "ar"), token));
    }
    await Promise.all([drain(a.poller), drain(b.poller)]);
    const sent = [...a.mail.sent, ...b.mail.sent].map((m) => m.idempotencyKey).sort();
    expect(sent).toEqual([...ids].sort());
    expect(a.mail.sent.length).toBeGreaterThan(0);
    expect(b.mail.sent.length).toBeGreaterThan(0);
  });

  it("stop() waits for the event in flight to record its outcome", async () => {
    const mail = new FakeMail();
    let release!: () => void;
    let started!: () => void;
    const inFlight = new Promise<void>((resolve) => (started = resolve));
    mail.result = () =>
      new Promise((resolve) => {
        started();
        release = () => resolve({ sent: true });
      });
    const h = make(mail);
    const clinic = seedClinic();
    const token = newToken();
    const invite = seedInvitation(clinic, token);
    const id = seedEvent(sealer, USER_INVITED, clinic.clinicId, userFields(invite, "ar"), token);
    h.poller.start();
    await inFlight;
    let stopped = false;
    const stopping = h.poller.stop().then(() => (stopped = true));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(eventRow(id).dispatched_at).not.toBeNull();
    expect(
      owner(
        "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE a.application_name = 'eyadex-dispatcher' AND l.mode = 'RowShareLock'",
      ),
    ).toBe("0");
  });
});
