import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { escapeHtml, formatExpiry } from "../domain/invitation-email.ts";
import { parseInvitationEvent, USER_INVITED } from "../domain/invitation-event.ts";
import { afterFailure } from "../domain/retry-schedule.ts";
import { skipReason } from "../domain/send-decision.ts";

const now = new Date("2026-10-07T00:00:00Z");
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const state = (over: object = {}) => ({
  status: "pending" as const,
  expiresAt: new Date("2026-10-14T00:00:00Z"),
  tokenHash: hash("tok"),
  timezone: "Asia/Kuwait",
  hasActiveBranch: true,
  ...over,
});

describe("send decision", () => {
  it("sends only a pending, unexpired invitation whose hash matches", () => {
    expect(skipReason(state(), "tok", now)).toBeNull();
    expect(skipReason(null, "tok", now)).toBe("missing");
    expect(skipReason(state({ status: "cancelled" }), "tok", now)).toBe("cancelled");
    expect(skipReason(state({ status: "accepted" }), "tok", now)).toBe("accepted");
    expect(skipReason(state({ expiresAt: now }), "tok", now)).toBe("expired");
    expect(skipReason(state(), "other", now)).toBe("superseded");
    expect(skipReason(state({ hasActiveBranch: false }), "tok", now)).toBe("no_active_branch");
  });
});

describe("retry schedule", () => {
  it("waits 1 min, 5 min, 30 min, 2 h, then gives up at the fifth failure", () => {
    const delays = [0, 1, 2, 3].map((n) => {
      const step = afterFailure(n, now);
      return step.kind === "retry" ? (step.nextAttemptAt.getTime() - now.getTime()) / 60_000 : -1;
    });
    expect(delays).toEqual([1, 5, 30, 120]);
    expect(afterFailure(4, now).kind).toBe("give_up");
  });
});

describe("email content", () => {
  it("escapes every HTML-significant character", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("writes the expiry in the clinic's time zone", () => {
    expect(formatExpiry(new Date("2026-10-13T22:30:00Z"), "en", "Asia/Kuwait")).toContain(
      "14 October 2026",
    );
  });

  it("refuses a payload with a missing field", () => {
    expect(parseInvitationEvent(USER_INVITED, { clinicId: "x" })).toBeNull();
  });
});
