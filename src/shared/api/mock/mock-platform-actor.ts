import type { PlatformAccount } from "@contracts/platform";
import type { Persona } from "@contracts/session";
import { ApiError } from "../api-error";
import { newId, type MockState } from "./mock-store";

/**
 * The signed-in platform account: the pinned one (memberId) or the first active one.
 * A deactivated account ends the session, as on the clinic side.
 */
export function resolvePlatformActor(db: MockState, persona: Persona): PlatformAccount {
  if (persona.kind !== "platform_admin") throw new ApiError("forbidden");
  const account = persona.memberId
    ? db.platformAccounts.find((a) => a.id === persona.memberId)
    : db.platformAccounts.find((a) => a.status === "active");
  if (!account) throw new ApiError("account_disabled");
  if (account.status !== "active") throw new ApiError("account_disabled");
  return account;
}

type Snapshot = Record<string, unknown> | null;

/** Single writer for platform events; before/after are allowlisted by the caller. */
export function writePlatformAudit(
  db: MockState,
  entry: {
    actorName: string;
    action: string;
    clinicId: string | null;
    entityId?: string | null;
    summary: string;
    before: Snapshot;
    after: Snapshot;
  },
): void {
  db.platformAudit.unshift({
    id: newId(),
    actorName: entry.actorName,
    action: entry.action,
    clinicId: entry.clinicId,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    before: entry.before,
    after: entry.after,
    createdAt: new Date().toISOString(),
  });
}

export function platformAccountSnapshot(a: PlatformAccount) {
  return { fullName: a.fullName, email: a.email, status: a.status };
}
