import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";

import type { ClaimedEvent } from "@eyadex/db";
import { createLogger } from "@eyadex/observability";
import { describe, expect, it } from "vitest";

import type { MailMessage, MailResult } from "../../invitation-mail/ports/mail-sender.ts";
import { WORKER_LOG_EVENTS } from "../../shared/log-events.ts";
import { daysLeft, EXPIRY_REMINDER, isDue, reminderSkip } from "../domain/reminder-rules.ts";
import { renderReminderEmail } from "../domain/reminder-email.ts";
import { expiryReminderDispatcher } from "../handle-expiry-reminder.ts";
import type { ReminderState } from "../ports/reminder-store.ts";
import { ExpiryReminderScanner } from "../scan-expiry-reminders.ts";

const NOW = new Date("2031-05-10T09:00:00Z");
const DAY = 24 * 3600 * 1000;
const MEMBER = "0190a000-0000-7000-8000-000000000001";
const at = (ms: number) => new Date(NOW.getTime() + ms);

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

describe("the reminder window (story 79, ADR-0020)", () => {
  it("is due inside the alert days only, never for a suspended or expired clinic", () => {
    expect(isDue({ status: "trial", expiresAt: at(7 * DAY) }, 7, NOW)).toBe(true);
    expect(isDue({ status: "active", expiresAt: at(7 * DAY + 1) }, 7, NOW)).toBe(false);
    expect(isDue({ status: "suspended", expiresAt: at(DAY) }, 7, NOW)).toBe(false);
    // The guard's boundary: at the expiry instant access has already ended.
    expect(isDue({ status: "active", expiresAt: NOW }, 7, NOW)).toBe(false);
  });

  it("skips at send time when renewed, suspended, expired or without an active admin", () => {
    const event = {
      clinicId: randomUUID(),
      reminderId: randomUUID(),
      expiresAt: at(3 * DAY).toISOString(),
      membershipId: randomUUID(),
      daysLeft: 3,
    };
    const clinic = { status: "active" as const, expiresAt: at(3 * DAY) };
    const admin = {};
    expect(reminderSkip({ clinic, recipient: admin }, event, NOW)).toBeNull();
    expect(reminderSkip(null, event, NOW)).toBe("missing");
    expect(
      reminderSkip(
        { clinic: { ...clinic, expiresAt: at(40 * DAY) }, recipient: admin },
        event,
        NOW,
      ),
    ).toBe("renewed");
    expect(
      reminderSkip({ clinic: { ...clinic, status: "suspended" }, recipient: admin }, event, NOW),
    ).toBe("suspended");
    expect(reminderSkip({ clinic, recipient: admin }, event, at(3 * DAY))).toBe("expired");
    expect(reminderSkip({ clinic, recipient: null }, event, NOW)).toBe("not_admin");
    expect(daysLeft(at(2 * DAY - 1000), NOW)).toBe(2);
  });

  it("renders the clinic language, escapes typed names and keeps the subject on one line", () => {
    const email = renderReminderEmail({
      language: "ar",
      clinicName: "عيادة <b>النور</b>\r\nBcc: x",
      recipientName: "<script>",
      daysLeft: 3,
      expiresOn: "13 مايو 2031",
    });
    expect(email.html).toContain('dir="rtl"');
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<b>");
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.text).toContain("3");
  });
});

function state(admin = true): ReminderState {
  return {
    clinic: {
      status: "active",
      expiresAt: at(3 * DAY),
      nameAr: "عيادة",
      nameEn: "Clinic",
      language: "en",
      timezone: "Asia/Kuwait",
    },
    recipient: admin
      ? { membershipId: MEMBER, fullName: "Admin", email: "admin0@example.test" }
      : null,
  };
}

function event(clinicId: string, expiresAt = at(3 * DAY)): ClaimedEvent {
  return {
    id: randomUUID(),
    clinicId,
    type: EXPIRY_REMINDER,
    payload: {
      clinicId,
      reminderId: randomUUID(),
      expiresAt: expiresAt.toISOString(),
      membershipId: MEMBER,
      daysLeft: 3,
    },
    attempts: 0,
  } as unknown as ClaimedEvent;
}

describe("sending a reminder", () => {
  it("mails its admin through platform mail; a retry sends the same message under the same key", async () => {
    const sent: MailMessage[] = [];
    const { logger, lines } = logs();
    const handle = expiryReminderDispatcher({
      state: { read: async () => state() },
      mail: {
        send: async (m): Promise<MailResult> => (
          sent.push(m),
          { sent: true, provider: "resend", fallback: false }
        ),
      },
      clock: { now: () => NOW },
      logger,
    });
    const e = event(randomUUID());
    expect(await handle(e)).toEqual({ kind: "dispatched" });
    // A day later (a retry crossing midnight): the body comes from the event, so it is identical.
    const later = expiryReminderDispatcher({
      state: { read: async () => state() },
      mail: {
        send: async (m) => (sent.push(m), { sent: true, provider: "resend", fallback: false }),
      },
      clock: { now: () => at(DAY) },
      logger,
    });
    expect(await later(e)).toEqual({ kind: "dispatched" });
    expect(sent.map((m) => m.to)).toEqual(["admin0@example.test", "admin0@example.test"]);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]!.idempotencyKey).toBe(e.id);
    // Platform mail: no clinic sender is ever set here.
    expect(sent.every((m) => m.from === undefined)).toBe(true);
    expect(lines.join("")).not.toContain("admin0@example.test");
  });

  it("NEGATIVE: a renewed clinic or a demoted admin gets no email; a malformed payload fails", async () => {
    const sent: MailMessage[] = [];
    const handle = expiryReminderDispatcher({
      state: { read: async () => state() },
      mail: {
        send: async (m) => (sent.push(m), { sent: true, provider: "resend", fallback: false }),
      },
      clock: { now: () => NOW },
      logger: logs().logger,
    });
    expect(await handle(event(randomUUID(), at(30 * DAY)))).toEqual({ kind: "dispatched" });
    const demoted = expiryReminderDispatcher({
      state: { read: async () => state(false) },
      mail: {
        send: async (m) => (sent.push(m), { sent: true, provider: "resend", fallback: false }),
      },
      clock: { now: () => NOW },
      logger: logs().logger,
    });
    expect(await demoted(event(randomUUID()))).toEqual({ kind: "dispatched" });
    expect(sent).toHaveLength(0);
    const bad = { ...event(randomUUID()), payload: { clinicId: "x" } } as ClaimedEvent;
    expect(await handle(bad)).toMatchObject({ kind: "failed", error: "invalid_payload" });
  });

  it("retries on the mail schedule when a send fails", async () => {
    const handle = expiryReminderDispatcher({
      state: { read: async () => state() },
      mail: { send: async () => ({ sent: false, error: "resend_500" }) },
      clock: { now: () => NOW },
      logger: logs().logger,
    });
    expect(await handle(event(randomUUID()))).toMatchObject({ kind: "retry", error: "resend_500" });
  });
});

describe("the scan", () => {
  it("queues each due clinic once, and one failing clinic does not stop the others", async () => {
    const queued = new Set<string>();
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const scanner = new ExpiryReminderScanner({
      finder: { dueClinics: async () => ids },
      ledger: {
        queue: async (clinicId) => {
          if (clinicId === ids[1]) throw new Error("boom");
          if (queued.has(clinicId)) return false;
          queued.add(clinicId);
          return true;
        },
      },
      clock: { now: () => NOW },
      logger: logs().logger,
      intervalMs: 60_000,
    });
    expect(await scanner.runOnce()).toEqual({ due: 3, queued: 2, failed: 1 });
    // A second tick on the same day queues nothing new (the ledger's unique key).
    expect(await scanner.runOnce()).toEqual({ due: 3, queued: 0, failed: 1 });
  });

  it("runs at start and stops cleanly", async () => {
    let scans = 0;
    const scanner = new ExpiryReminderScanner({
      finder: { dueClinics: async () => (scans++, []) },
      ledger: { queue: async () => false },
      clock: { now: () => NOW },
      logger: logs().logger,
      intervalMs: 60_000,
    });
    scanner.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await scanner.stop();
    expect(scans).toBe(1);
  });
});
