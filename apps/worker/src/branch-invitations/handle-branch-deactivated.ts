import type { ClaimedEvent, DispatchOutcome } from "@eyadex/db";
import type { Logger } from "@eyadex/observability";

import { afterFailure } from "../invitation-mail/domain/retry-schedule.ts";
import { parseBranchDeactivated } from "./domain/branch-event.ts";
import type { OrphanInvitationCanceller } from "./ports/orphan-invitation-canceller.ts";

export interface BranchDeactivatedDeps {
  readonly canceller: OrphanInvitationCanceller;
  readonly clock: { now(): Date };
  readonly logger: Logger;
}

/**
 * الشغلانة التانية للـ worker (ADR-0013 §12): بعد تعطيل فرع، يلغي الدعوات المعلّقة اللي مابقالهاش فرع
 * نشط. السطر المسجّل فيه id الحدث ونوعه والنتيجة والعدد بس — مفيش إيميل ولا اسم ولا رسالة خطأ خام.
 */
export function branchDeactivatedHandler(deps: BranchDeactivatedDeps) {
  const failed = (event: ClaimedEvent, error: string): DispatchOutcome => {
    deps.logger.error(
      { outbox: { id: event.id, type: event.type, outcome: "failed", error } },
      "outbox event failed",
    );
    return { kind: "failed", error };
  };

  return async (event: ClaimedEvent): Promise<DispatchOutcome> => {
    const parsed = parseBranchDeactivated(event.payload, event.clinicId);
    if (parsed === null) return failed(event, "invalid_payload");
    let count: number;
    try {
      count = await deps.canceller.cancelOrphaned(
        {
          clinicId: parsed.clinicId,
          branchId: parsed.branchId,
          deactivatedAt: new Date(parsed.deactivatedAt),
          eventId: event.id,
          actorUserId: parsed.actorUserId,
        },
        () => deps.clock.now(),
      );
    } catch {
      // The tenant transaction rolled back, so a retry starts clean. The raw message is never logged.
      const step = afterFailure(event.attempts, deps.clock.now());
      if (step.kind === "give_up") return failed(event, "db_error");
      deps.logger.info(
        {
          outbox: {
            id: event.id,
            type: event.type,
            outcome: "retry",
            error: "db_error",
            attempt: event.attempts + 1,
          },
        },
        "outbox event handled",
      );
      return { kind: "retry", error: "db_error", nextAttemptAt: step.nextAttemptAt };
    }
    deps.logger.info(
      { outbox: { id: event.id, type: event.type, outcome: "cancelled", count } },
      "outbox event handled",
    );
    return { kind: "dispatched" };
  };
}
