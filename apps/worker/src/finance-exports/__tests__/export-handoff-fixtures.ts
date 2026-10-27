import { Writable } from "node:stream";

import type { ClaimedEvent, DispatchOutcome, DispatcherOutbox } from "@eyadex/db";
import { createLogger, type Logger } from "@eyadex/observability";

import { ExportHandoffQueue } from "../export-handoff-queue.ts";
import type { LeasedExportIdentity } from "../ports/export-lease-handoff.ts";

/** Commit-timeline markers only. This double does not prove SQL, roles, or a lease write. */
export const CLINIC_ID = "019a0000-0000-7000-8000-000000000001";
export const EXPORT_A = "019a0000-0000-7000-8000-00000000000a";
export const EXPORT_B = "019a0000-0000-7000-8000-00000000000b";
export const LEASE_OWNER = "worker-handoff-test";
export const FIXED_NOW = new Date("2026-10-26T12:00:00.000Z");

export const DEFERRED: DispatchOutcome = {
  kind: "deferred",
  nextAttemptAt: new Date("2026-10-26T12:01:00.000Z"),
};

export function identity(
  exportId: string = EXPORT_A,
  attempt = 1,
  leaseOwner: string = LEASE_OWNER,
): LeasedExportIdentity {
  return { clinicId: CLINIC_ID, exportId, attempt, leaseOwner };
}

export function claimedEvent(exportId: string = EXPORT_A): ClaimedEvent {
  return {
    id: "019a0000-0000-7000-8000-0000000000e1",
    clinicId: CLINIC_ID,
    type: "finance.report_export_requested",
    payload: { exportId },
    attempts: 0,
    createdAt: FIXED_NOW,
  };
}

export interface Gate<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

export function deferred<T>(): Gate<T> {
  let resolve!: Gate<T>["resolve"];
  let reject!: Gate<T>["reject"];
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export async function flush(turns = 8): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

export function queueWith(
  execute: (identity: LeasedExportIdentity, signal: AbortSignal) => Promise<void>,
  extra: { concurrency?: number; logger?: Logger } = {},
): ExportHandoffQueue {
  return new ExportHandoffQueue({
    execute,
    logger: extra.logger ?? silentLogger(),
    ...(extra.concurrency === undefined ? {} : { concurrency: extra.concurrency }),
  });
}

export function silentLogger(): Logger {
  return { error() {}, info() {} } as unknown as Logger;
}

export function recordingLogger(throwOnError = false): {
  readonly calls: unknown[][];
  readonly logger: Logger;
} {
  const calls: unknown[][] = [];
  return {
    calls,
    logger: {
      error(...args: unknown[]) {
        calls.push(args);
        if (throwOnError) throw new Error("diagnostic failed");
      },
      info() {},
    } as unknown as Logger,
  };
}

/** Real worker logger, so a secret in a field would show up in the sink. */
export function sinkLogger(): { readonly lines: string[]; readonly logger: Logger } {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { lines, logger: createLogger("info", { destination, events: ["error"] }) };
}

export interface CommitStep {
  readonly commit: Gate<void>;
  runHandler: boolean;
  handlerFinished: boolean;
  committed: boolean;
  event: ClaimedEvent | null;
}

/** Commit timeline only. `committed` flips after resolve; a throw or rejected commit leaves it false. Not a database. */
export function commitTimeline(): {
  readonly outbox: DispatcherOutbox;
  readonly claims: CommitStep[];
  readonly claimCalls: number;
} {
  const claims: CommitStep[] = [];
  const state = { claimCalls: 0 };
  const outbox: DispatcherOutbox = {
    async claimNext(_types, _now, handle) {
      const step = claims[state.claimCalls];
      state.claimCalls += 1;
      if (step === undefined) throw new Error("unexpected claim");
      if (step.runHandler && step.event !== null) {
        await handle(step.event);
        step.handlerFinished = true;
      }
      await step.commit.promise;
      step.committed = true;
      return step.event === null ? null : { event: step.event, outcome: DEFERRED };
    },
    async purgeExpired() {
      throw new Error("handoff test must not purge");
    },
    async ping() {
      throw new Error("handoff test must not ping");
    },
    async close() {
      return undefined;
    },
  };
  return {
    outbox,
    claims,
    get claimCalls() {
      return state.claimCalls;
    },
  };
}

export function openStep(
  runHandler: boolean,
  event: ClaimedEvent | null = claimedEvent(),
): CommitStep {
  return { commit: deferred<void>(), runHandler, handlerFinished: false, committed: false, event };
}
