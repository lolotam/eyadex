import { randomUUID } from "node:crypto";

import {
  createDatabase,
  createDispatcherOutbox,
  sql,
  type Database,
  type DispatcherOutbox,
} from "@eyadex/db";

import {
  captureLogs,
  owner,
  ownerJson,
  urls,
} from "../../invitation-mail/__tests__/dispatch-fixtures.ts";
import { routeEvents, type EventHandler } from "../../shared/event-router.ts";
import { OutboxPoller } from "../../shared/outbox-poller.ts";
import { BRANCH_DEACTIVATED } from "../domain/branch-event.ts";
import { branchDeactivatedHandler } from "../handle-branch-deactivated.ts";
import { PgOrphanInvitationCanceller } from "../persistence/pg-orphan-invitation-canceller.ts";
import type { OrphanInvitationCanceller } from "../ports/orphan-invitation-canceller.ts";

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

export function seedBranch(clinicId: string, active = true): string {
  const id = randomUUID();
  owner(`INSERT INTO branches (clinic_id, id, name_ar, name_en, is_active, created_at, updated_at)
         VALUES (${q(clinicId)}, ${q(id)}, 'فرع', 'Branch', ${active}, now(), now())`);
  return id;
}

export const setBranchActive = (clinicId: string, branchId: string, active: boolean) =>
  owner(
    `UPDATE branches SET is_active = ${active} WHERE clinic_id = ${q(clinicId)} AND id = ${q(branchId)}`,
  );

/** Limits an invitation to `branchIds` (all_branches = false), or marks it all-branches. */
export function scopeInvitation(
  clinicId: string,
  invitationId: string,
  branchIds: readonly string[] | "all",
): void {
  const all = branchIds === "all";
  const links = all
    ? ""
    : branchIds
        .map(
          (b) => `INSERT INTO invitation_branches (clinic_id, id, invitation_id, branch_id)
                  VALUES (${q(clinicId)}, ${q(randomUUID())}, ${q(invitationId)}, ${q(b)});`,
        )
        .join("\n");
  owner(`UPDATE invitations SET all_branches = ${all}
         WHERE clinic_id = ${q(clinicId)} AND id = ${q(invitationId)}; ${links}`);
}

export const invitationStatus = (clinicId: string, id: string) =>
  owner(`SELECT status FROM invitations WHERE clinic_id = ${q(clinicId)} AND id = ${q(id)}`);

export const auditRows = (clinicId: string, entityId: string) =>
  ownerJson<{ action: string; actor_user_id: string; details: Record<string, unknown> }[]>(
    `SELECT action, actor_user_id, details FROM audit_log
     WHERE clinic_id = ${q(clinicId)} AND entity_id = ${q(entityId)} ORDER BY created_at, id`,
  );

let order = 0;

export function seedBranchEvent(
  clinicId: string,
  payload: Record<string, unknown>,
  type = BRANCH_DEACTIVATED,
): string {
  const id = randomUUID();
  order += 1;
  owner(`INSERT INTO outbox_events (id, clinic_id, event_type, payload, created_at)
         VALUES (${q(id)}, ${q(clinicId)}, ${q(type)}, ${q(JSON.stringify(payload))}::jsonb,
                 now() - interval '1 hour' + ${order} * interval '1 millisecond')`);
  return id;
}

export const branchPayload = (clinicId: string, branchId: string, actorUserId = randomUUID()) => ({
  clinicId,
  branchId,
  actorUserId,
  deactivatedAt: new Date().toISOString(),
});

/** Reserves an email for an invitation the way the API does, as eyadex_app under its clinic. */
export const reserve = (app: Database, clinicId: string, email: string, invitationId: string) =>
  app.withTenant(clinicId, async (tx) => {
    const rows = (await tx.execute(
      sql`SELECT reserve_invitation_email(${email}, ${invitationId},
            ${new Date(Date.now() + 86_400_000).toISOString()}::timestamptz) AS ok`,
    )) as unknown as { ok: boolean }[];
    return rows[0]!.ok;
  });

export interface BranchHarness {
  readonly app: Database;
  readonly outbox: DispatcherOutbox;
  readonly poller: OutboxPoller;
  readonly canceller: PgOrphanInvitationCanceller;
  readonly clock: { now(): Date };
  readonly lines: string[];
  close(): Promise<void>;
}

export function branchHarness(
  options: { canceller?: OrphanInvitationCanceller; extra?: Record<string, EventHandler> } = {},
): BranchHarness {
  const app = createDatabase({ url: urls().app, role: "eyadex_app", ids: { newId: randomUUID } });
  const outbox = createDispatcherOutbox({ url: urls().dispatcher });
  const clock = { now: () => new Date() };
  const { lines, logger } = captureLogs();
  const canceller = new PgOrphanInvitationCanceller(app, { newId: randomUUID });
  const route = routeEvents({
    ...options.extra,
    [BRANCH_DEACTIVATED]: branchDeactivatedHandler({
      canceller: options.canceller ?? canceller,
      clock,
      logger,
    }),
  });
  const poller = new OutboxPoller({
    outbox,
    types: route.types,
    handle: route.handle,
    now: clock.now,
    intervalMs: 20,
    logger,
  });
  return {
    app,
    outbox,
    poller,
    canceller,
    clock,
    lines,
    close: async () => {
      await Promise.all([app.close(), outbox.close()]);
    },
  };
}
