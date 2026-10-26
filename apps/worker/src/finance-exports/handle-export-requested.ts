import type { ClaimedEvent, DispatchOutcome } from "@eyadex/db";
import type { Logger } from "@eyadex/observability";

import { parseExportRequested } from "./domain/export-event.ts";
import type { ExportLeaseHandoff } from "./ports/export-lease-handoff.ts";
import type { ExportClaimPort } from "./ports/export-store.ts";

/** اعتمادات الالتقاط. مفيش بناء ولا رفع ولا قارئ تقارير. */
export interface ExportRequestedDeps {
  readonly claims: ExportClaimPort;
  readonly handoff: ExportLeaseHandoff;
  readonly leaseOwner: string;
  readonly logger: Logger;
}

/**
 * يلتقط `finance.report_export_requested` ويسجّل التأجير ويرجع `deferred`. البناء بعد الالتزام، مش هنا.
 *
 * @param deps مخزن الالتقاط والتسليم الضيق ومالك التأجير
 * @returns معالج الـ dispatcher
 */
export function handleExportRequested(deps: ExportRequestedDeps) {
  return async (event: ClaimedEvent): Promise<DispatchOutcome> => {
    const parsed = parseExportRequested(event);
    if (parsed === null) {
      deps.logger.error(
        { outbox: { id: event.id, type: event.type, outcome: "failed", error: "invalid_payload" } },
        "outbox event failed",
      );
      return { kind: "failed", error: "invalid_payload" };
    }
    const decision = await deps.claims.decideClaim({
      clinicId: parsed.clinicId,
      exportId: parsed.exportId,
      leaseOwner: deps.leaseOwner,
    });
    if (decision.kind === "leased") {
      deps.handoff.record({
        clinicId: parsed.clinicId,
        exportId: parsed.exportId,
        attempt: decision.attempt,
        leaseOwner: deps.leaseOwner,
      });
      deps.logger.info(
        { outbox: { id: event.id, type: event.type, outcome: "deferred" } },
        "outbox event handled",
      );
      return { kind: "deferred", nextAttemptAt: decision.leaseUntil };
    }
    if (decision.kind === "failed") {
      deps.logger.error(
        { outbox: { id: event.id, type: event.type, outcome: "failed", error: decision.error } },
        "outbox event failed",
      );
      return decision;
    }
    deps.logger.info(
      { outbox: { id: event.id, type: event.type, outcome: decision.kind } },
      "outbox event handled",
    );
    return decision.kind === "dispatched" ? { kind: "dispatched" } : decision;
  };
}
