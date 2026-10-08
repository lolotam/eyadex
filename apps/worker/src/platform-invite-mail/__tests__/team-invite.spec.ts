import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Writable } from "node:stream";

import type { ClaimedEvent } from "@eyadex/db";
import { createLogger } from "@eyadex/observability";
import { SecretSealer } from "@eyadex/secrets";
import { describe, expect, it } from "vitest";

import type { MailMessage, MailResult } from "../../invitation-mail/ports/mail-sender.ts";
import { WORKER_LOG_EVENTS } from "../../shared/log-events.ts";
import { NamedPlatformSender } from "../../shared/named-platform-sender.ts";
import { TEAM_INVITED, teamInviteSkip, type TeamInviteState } from "../domain/team-invite.ts";
import { teamInviteDispatcher } from "../handle-team-invited.ts";

const NOW = new Date("2031-05-10T09:00:00Z");
const hash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
const sealer = new SecretSealer(randomBytes(32).toString("base64"));

function logs() {
  const lines: string[] = [];
  const sink = new Writable({
    write: (chunk, _e, done) => {
      lines.push(String(chunk));
      done();
    },
  });
  return { lines, logger: createLogger("info", { destination: sink, events: WORKER_LOG_EVENTS }) };
}

function setup(state: (token: string) => TeamInviteState | null) {
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const event = {
    id,
    clinicId: null,
    type: TEAM_INVITED,
    attempts: 0,
    payload: {
      accountId: randomUUID(),
      email: "member@example.test",
      fullName: "New <Member>",
      expiresAt: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(),
      sealedToken: sealer.seal(token, id),
    },
  } as unknown as ClaimedEvent;
  const sent: MailMessage[] = [];
  const { lines, logger } = logs();
  const handle = teamInviteDispatcher({
    sealer,
    accounts: { whileLocked: (_id, fn) => fn(state(token)) },
    mail: {
      send: async (m): Promise<MailResult> => (
        sent.push(m),
        { sent: true, provider: "resend", fallback: false }
      ),
    },
    clock: { now: () => NOW },
    platformUrl: "https://platform.eyadex.test",
    logger,
  });
  return { token, event, sent, lines, handle };
}

const invited = (token: string): TeamInviteState => ({
  status: "invited",
  tokenHash: hash(token),
  tokenExpiresAt: new Date(NOW.getTime() + 86_400_000),
});

describe("platform-team invitation mail (ADR-0020)", () => {
  it("mails a usable link on the platform host; the token is in no log line", async () => {
    const t = setup(invited);
    expect(await t.handle(t.event)).toEqual({ kind: "dispatched" });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.html).toContain(`https://platform.eyadex.test/invite/${t.token}`);
    expect(t.sent[0]!.html).not.toContain("<Member>");
    expect(t.sent[0]!.idempotencyKey).toBe(t.event.id);
    expect(t.lines.join("")).not.toContain(t.token);
    expect(t.lines.join("")).not.toContain("member@example.test");
  });

  it("NEGATIVE: a re-issued, expired, joined or deactivated link is skipped without an email", async () => {
    for (const state of [
      (token: string) => ({ ...invited(token), tokenHash: hash(`${token}x`) }),
      (token: string) => ({ ...invited(token), tokenExpiresAt: NOW }),
      (token: string) => ({ ...invited(token), status: "active" as const }),
      (token: string) => ({ ...invited(token), status: "deactivated" as const }),
      () => null,
    ]) {
      const t = setup(state);
      expect(await t.handle(t.event)).toEqual({ kind: "dispatched" });
      expect(t.sent).toHaveLength(0);
    }
    expect(teamInviteSkip(null, "t", NOW)).toBe("missing");
  });

  it("NEGATIVE: a clinic-scoped row or a seal from another event fails at once", async () => {
    const t = setup(invited);
    const scoped = { ...t.event, clinicId: randomUUID() } as ClaimedEvent;
    expect(await t.handle(scoped)).toMatchObject({ kind: "failed", error: "invalid_payload" });
    const moved = { ...t.event, id: randomUUID() } as ClaimedEvent;
    expect(await t.handle(moved)).toMatchObject({ kind: "failed", error: "seal_unreadable" });
  });
});

describe("the platform sender name (story 26)", () => {
  it("names platform mail with the setting, and leaves a clinic or on-behalf sender alone", async () => {
    const seen: MailMessage[] = [];
    const inner = {
      send: async (m: MailMessage): Promise<MailResult> => (
        seen.push(m),
        { sent: true, provider: "resend", fallback: false }
      ),
    };
    const named = new NamedPlatformSender(
      inner,
      "no-reply@example.test",
      async () => "Eyadex Team",
    );
    const base = { to: "a@example.test", subject: "s", html: "h", text: "t", idempotencyKey: "k" };
    await named.send(base);
    await named.send({ ...base, from: { name: "Clinic", address: "c@example.test" } });
    expect(seen[0]!.from).toEqual({ name: "Eyadex Team", address: "no-reply@example.test" });
    expect(seen[1]!.from).toEqual({ name: "Clinic", address: "c@example.test" });
    const failing = new NamedPlatformSender(inner, "no-reply@example.test", async () => {
      throw new Error("db down");
    });
    await failing.send(base);
    expect(seen[2]!.from).toBeUndefined();
  });
});
