import { randomBytes } from "node:crypto";

import { SecretSealer } from "@eyadex/secrets";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { decideFallback } from "../domain/fallback-decision.ts";
import { USER_INVITED } from "../domain/invitation-event.ts";
import { FallbackMailSender } from "../mail/fallback-mail-sender.ts";
import {
  drain,
  eventRow,
  FakeMail,
  harness,
  newToken,
  parkLeftovers,
  seedClinic,
  seedEvent,
  seedInvitation,
  userFields,
  type Harness,
} from "./dispatch-fixtures.ts";

const sealer = new SecretSealer(randomBytes(32).toString("base64"));
const open: Harness[] = [];

beforeAll(parkLeftovers);
afterEach(parkLeftovers);
afterAll(async () => {
  await Promise.all(open.map((h) => h.close()));
});

const setup = (primaryError: string) => {
  const primary = new FakeMail();
  primary.result = async () => ({ sent: false, error: primaryError });
  const secondary = new FakeMail();
  secondary.result = async () => ({ sent: true, provider: "smtp", fallback: false });
  const h = harness(sealer, primary, new FallbackMailSender(primary, secondary, decideFallback));
  open.push(h);
  const clinic = seedClinic();
  const token = newToken();
  const invite = seedInvitation(clinic, token);
  const id = seedEvent(sealer, USER_INVITED, clinic.clinicId, userFields(invite, "ar"), token);
  return { h, secondary, id };
};

describe("platform SMTP fallback through the poller (ADR-0014)", () => {
  it("a Resend 500 hands the mail to SMTP and the event is dispatched", async () => {
    const { h, secondary, id } = setup("resend_500");
    await drain(h.poller);
    expect(secondary.sent).toHaveLength(1);
    const row = eventRow(id);
    expect(row.dispatched_at).not.toBeNull();
    expect(row.last_error).toBeNull();
    const sent = h.lines.find((l) => l.includes(`"outcome":"sent"`));
    expect(sent).toContain(`"fallback":true`);
    expect(sent).toContain(`"provider":"smtp"`);
  });

  it("a Resend timeout never reaches SMTP and the event waits for a retry", async () => {
    const { h, secondary, id } = setup("resend_timeout");
    await drain(h.poller);
    expect(secondary.sent).toHaveLength(0);
    const row = eventRow(id);
    expect(row.dispatched_at).toBeNull();
    expect(row.failed_at).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.next_attempt_at).not.toBeNull();
    expect(row.last_error).toBe("resend_timeout");
  });
});
