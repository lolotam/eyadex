import { randomBytes } from "node:crypto";

import { SecretSealer } from "@eyadex/secrets";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { scopeInvitation, seedBranch } from "../../branch-invitations/__tests__/branch-fixtures.ts";
import { USER_INVITED } from "../domain/invitation-event.ts";
import {
  drain,
  eventRow,
  harness,
  newToken,
  owner,
  parkLeftovers,
  seedClinic,
  seedEvent,
  seedInvitation,
  userFields,
  type Harness,
} from "./dispatch-fixtures.ts";

const sealer = new SecretSealer(randomBytes(32).toString("base64"));
const open: Harness[] = [];
const make = () => {
  const h = harness(sealer);
  open.push(h);
  return h;
};

beforeAll(parkLeftovers);
afterEach(parkLeftovers);
afterAll(async () => {
  await Promise.all(open.map((h) => h.close()));
});

function invitationOn(active: readonly boolean[]) {
  const clinic = seedClinic("en");
  const token = newToken();
  const invite = seedInvitation(clinic, token);
  const branches = active.map((isActive) => seedBranch(clinic.clinicId, isActive));
  scopeInvitation(clinic.clinicId, invite.invitationId, branches);
  const id = seedEvent(sealer, USER_INVITED, clinic.clinicId, userFields(invite, "en"), token);
  return { id, branches };
}

// A backlog claims by created_at, so an invitation's mail is handled before the later
// clinic.branch_deactivated that would cancel it (ADR-0013 §12): the send-time check stops it.
describe("send-time check: an invitation needs an active branch", () => {
  it("skips the mail of an invitation whose branches are all inactive", async () => {
    const h = make();
    const { id } = invitationOn([false, false]);
    await drain(h.poller);
    expect(h.mail.sent).toHaveLength(0);
    expect(eventRow(id).dispatched_at).not.toBeNull();
    expect(h.lines.join("\n")).toContain('"reason":"no_active_branch"');
  });

  it("still mails an invitation with one active branch left", async () => {
    const h = make();
    invitationOn([false, true]);
    await drain(h.poller);
    expect(h.mail.sent).toHaveLength(1);
  });

  it("keeps the invitation's branches locked while sending: a deactivation arriving meanwhile waits", async () => {
    const h = make();
    const { branches } = invitationOn([true]);
    let deactivateDuringSend = "";
    h.mail.result = async () => {
      try {
        owner(`SET lock_timeout = '300ms';
               UPDATE branches SET is_active = false WHERE id = '${branches[0]}'`);
        deactivateDuringSend = "committed";
      } catch (error) {
        deactivateDuringSend = String((error as { stderr?: unknown }).stderr ?? error);
      }
      return { sent: true, provider: "resend", fallback: false };
    };
    await drain(h.poller);
    expect(deactivateDuringSend).toMatch(/lock timeout/);
    expect(h.mail.sent).toHaveLength(1);
  });
});
