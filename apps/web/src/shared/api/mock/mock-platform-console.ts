import { actorReplayKey } from "./mock-idempotency";
import {
  daysUntil,
  effectiveClinicStatus,
  invitePlatformAccountInputSchema,
  type EffectiveClinicStatus,
  type PlatformAccount,
} from "@eyadex/contracts/platform";
import { platformSettingsRequestSchema } from "@eyadex/contracts/platform-console";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import {
  platformAccountSnapshot,
  resolvePlatformActor,
  writePlatformAudit,
} from "./mock-platform-actor";
import { delay, getState, newId, persist, type MockState } from "./mock-store";
import { enforceEmailFree } from "./mock-user-rules";

// Idempotency-Key replays for the demo session (the API keeps them in its ledger, ADR-0020).
const inviteReplays = new Map<string, { fingerprint: string; accountId: string }>();

function findAccount(db: MockState, id: string): PlatformAccount {
  const account = db.platformAccounts.find((a) => a.id === id);
  if (!account) throw new ApiError("not_found");
  return account;
}

export function createMockPlatformOverview(): ApiClient["platformOverview"] {
  return {
    async get(persona) {
      await delay();
      const db = getState();
      resolvePlatformActor(db, persona);
      const now = Date.now();
      const counts: Record<EffectiveClinicStatus, number> = {
        trial: 0,
        active: 0,
        suspended: 0,
        expired: 0,
      };
      for (const c of db.clinics) counts[effectiveClinicStatus(c, now)] += 1;
      const alert = db.platformSettings.alertDaysBeforeExpiry;
      const expiringSoon = db.clinics
        .filter((c) => effectiveClinicStatus(c, now) !== "suspended")
        .map((c) => ({ c, daysLeft: daysUntil(c.expiresAt, now) }))
        // Strictly after now, like the API's `expires_at > now`: an expiry at now is already expired.
        .filter(({ c, daysLeft }) => new Date(c.expiresAt).getTime() > now && daysLeft <= alert)
        .sort((a, b) => a.c.expiresAt.localeCompare(b.c.expiresAt))
        .map(({ c, daysLeft }) => ({
          id: c.id,
          nameAr: c.nameAr,
          nameEn: c.nameEn,
          status: c.status,
          expiresAt: c.expiresAt,
          daysLeft,
        }));
      return { counts, alertDaysBeforeExpiry: alert, expiringSoon };
    },
  };
}

export function createMockPlatformTeam(): ApiClient["platformTeam"] {
  return {
    async list(persona) {
      await delay();
      const db = getState();
      resolvePlatformActor(db, persona);
      return [...db.platformAccounts].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async invite(persona, raw, idempotencyKey) {
      await delay();
      const db = getState();
      const actor = resolvePlatformActor(db, persona);
      const parsed = invitePlatformAccountInputSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError("validation");
      const fingerprint = JSON.stringify(parsed.data);
      const replayKey = actorReplayKey("platform", actor.id, idempotencyKey);
      const replay = inviteReplays.get(replayKey);
      if (replay) {
        if (replay.fingerprint !== fingerprint) throw new ApiError("idempotency_conflict");
        return findAccount(db, replay.accountId);
      }
      // The API rule (ADR-0020): an account still invited gets a new link; any other holder is taken.
      const existing = db.platformAccounts.find(
        (a) => a.email.toLowerCase() === parsed.data.email && a.status === "invited",
      );
      if (!existing) enforceEmailFree(db, parsed.data.email);
      const account: PlatformAccount = existing ?? {
        id: newId(),
        fullName: parsed.data.fullName,
        email: parsed.data.email,
        status: "invited",
        joinedAt: null,
        createdAt: new Date().toISOString(),
      };
      if (!existing) db.platformAccounts.push(account);
      writePlatformAudit(db, {
        actorName: actor.fullName,
        action: "platform_account.invited",
        clinicId: null,
        entityId: account.id,
        summary: `Invited ${account.email} to the platform team`,
        before: existing ? platformAccountSnapshot(existing) : null,
        after: platformAccountSnapshot(account),
      });
      inviteReplays.set(replayKey, { fingerprint, accountId: account.id });
      persist();
      return account;
    },

    async deactivate(persona, accountId) {
      await delay();
      const db = getState();
      const actor = resolvePlatformActor(db, persona);
      const account = findAccount(db, accountId);
      if (account.status === "deactivated") return account;
      const othersActive = db.platformAccounts.filter(
        (a) => a.id !== account.id && a.status === "active",
      ).length;
      if (account.status === "active" && othersActive === 0)
        throw new ApiError("last_active_platform_account");
      const before = platformAccountSnapshot(account);
      account.status = "deactivated";
      writePlatformAudit(db, {
        actorName: actor.fullName,
        action: "platform_account.deactivated",
        clinicId: null,
        entityId: account.id,
        summary: `Deactivated ${account.email}`,
        before,
        after: platformAccountSnapshot(account),
      });
      persist();
      return account;
    },

    async reactivate(persona, accountId) {
      await delay();
      const db = getState();
      const actor = resolvePlatformActor(db, persona);
      const account = findAccount(db, accountId);
      if (account.status !== "deactivated") return account;
      const before = platformAccountSnapshot(account);
      account.status = account.joinedAt ? "active" : "invited";
      writePlatformAudit(db, {
        actorName: actor.fullName,
        action: "platform_account.reactivated",
        clinicId: null,
        entityId: account.id,
        summary: `Reactivated ${account.email}`,
        before,
        after: platformAccountSnapshot(account),
      });
      persist();
      return account;
    },
  };
}

export function createMockPlatformSettings(): ApiClient["platformSettings"] {
  return {
    async get(persona) {
      await delay();
      const db = getState();
      resolvePlatformActor(db, persona);
      return { ...db.platformSettings };
    },

    async update(persona, raw) {
      await delay();
      const db = getState();
      const actor = resolvePlatformActor(db, persona);
      // The API's strict body: an unknown field or module is refused, never dropped.
      const parsed = platformSettingsRequestSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError("validation");
      const before = { ...db.platformSettings };
      db.platformSettings = { ...parsed.data };
      writePlatformAudit(db, {
        actorName: actor.fullName,
        action: "platform.settings_updated",
        clinicId: null,
        summary: "Updated platform settings",
        before,
        after: { ...db.platformSettings },
      });
      persist();
      return { ...db.platformSettings };
    },
  };
}
