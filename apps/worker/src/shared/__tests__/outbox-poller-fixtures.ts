import { Writable } from "node:stream";

import type { ClaimedEvent, DispatchOutcome, DispatcherOutbox } from "@eyadex/db";
import { createLogger, type Logger } from "@eyadex/observability";
import { expect } from "vitest";

import { WORKER_LOG_EVENTS } from "../log-events.ts";
import { OutboxPoller, type PollerDeps } from "../outbox-poller.ts";

export const FIXED_NOW = new Date("2026-10-26T12:00:00.000Z");

export const INTERVAL_MS = 5_000;

export const SHARED_TYPES = ["invitation.mail", "team.invite"] as const;

/** Marker only: a log line that contains it logged the claim payload. */
export const SEALED_MARKER = "not-for-logs";

export const CLAIMED: ClaimedEvent = {
  id: "019a1111-1111-7111-8111-111111111111",
  clinicId: "019a2222-2222-7222-8222-222222222222",
  type: "shared.event",
  payload: { sealedToken: SEALED_MARKER },
  attempts: 0,
  createdAt: FIXED_NOW,
};

export const DEFERRED: DispatchOutcome = {
  kind: "deferred",
  nextAttemptAt: new Date("2026-10-26T12:01:00.000Z"),
};

export interface ClaimResult {
  readonly event: ClaimedEvent;
  readonly outcome: DispatchOutcome;
}

export interface Gate<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

/** Yields microtasks until `ready`, then fails if the claim timeline never reached that point. */
export async function until(ready: () => boolean): Promise<void> {
  for (let turn = 0; turn < 30 && !ready(); turn += 1) await Promise.resolve();
  expect(ready()).toBe(true);
}

/** A promise whose settlement the spec controls, so a claim can stay open across assertions. */
export function deferredPromise<T>(): Gate<T> {
  let resolve!: Gate<T>["resolve"];
  let reject!: Gate<T>["reject"];
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Same construction the existing callers use, plus whichever hooks a spec turns on. */
export function pollerFor(
  outbox: DispatcherOutbox,
  extra: Partial<
    Pick<
      PollerDeps,
      "types" | "handle" | "now" | "intervalMs" | "logger" | "canClaim" | "afterClaim"
    >
  > = {},
): OutboxPoller {
  return new OutboxPoller({
    outbox,
    types: SHARED_TYPES,
    handle: async () => DEFERRED,
    now: () => FIXED_NOW,
    intervalMs: INTERVAL_MS,
    logger: silentLogger(),
    ...extra,
  });
}

export function silentLogger(): Logger {
  return createLogger("info", {
    destination: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
    events: WORKER_LOG_EVENTS,
  });
}

export function captureLogger(): { readonly lines: Record<string, unknown>[]; logger: Logger } {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split("\n").filter(Boolean)) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      done();
    },
  });
  return {
    lines,
    logger: createLogger("info", { destination, events: WORKER_LOG_EVENTS }),
  };
}

export interface CountingClock {
  calls: number;
  readonly now: () => Date;
}

export function countingClock(at: Date = FIXED_NOW): CountingClock {
  const clock: CountingClock = {
    calls: 0,
    now() {
      clock.calls += 1;
      return at;
    },
  };
  return clock;
}

export interface CountingClaim {
  readonly outbox: DispatcherOutbox;
  readonly claimCalls: { readonly types: readonly string[]; readonly at: Date }[];
  committedClaims: number;
  next: ClaimResult | null;
}

/** Boundary fake: records each claimNext and marks committed only as that call is about to resolve. */
export function countingOutbox(): CountingClaim {
  const claimCalls: { types: readonly string[]; at: Date }[] = [];
  const state: CountingClaim = {
    claimCalls,
    committedClaims: 0,
    next: null,
    outbox: {
      async claimNext(types, now, handle) {
        claimCalls.push({ types, at: now });
        const next = state.next;
        if (next === null) return null;
        await handle(next.event);
        state.committedClaims += 1;
        return next;
      },
      async purgeExpired() {
        throw new Error("poller must not purge");
      },
      async ping() {
        throw new Error("poller must not ping");
      },
      async close() {
        return undefined;
      },
    },
  };
  return state;
}

export interface ClaimTimeline {
  readonly outbox: DispatcherOutbox;
  readonly commit: Gate<void>;
  readonly claims: { readonly types: readonly string[]; readonly at: Date }[];
  handlerFinished: boolean;
  committed: boolean;
  inflight: boolean;
}

/**
 * Mirrors `client.begin`: the handler runs inside the open transaction, and the claim promise
 * resolves only after `commit` — that resolution is the COMMIT, not the handler's return.
 */
export function claimTimeline(options: {
  readonly result: ClaimResult | null;
  readonly runHandler?: boolean;
}): ClaimTimeline {
  const commit = deferredPromise<void>();
  const claims: { types: readonly string[]; at: Date }[] = [];
  const timeline: ClaimTimeline = {
    commit,
    claims,
    handlerFinished: false,
    committed: false,
    inflight: false,
    outbox: {
      async claimNext(types, now, handle) {
        claims.push({ types, at: now });
        timeline.inflight = true;
        timeline.committed = false;
        timeline.handlerFinished = false;
        if (options.runHandler === true && options.result !== null) {
          await handle(options.result.event);
          timeline.handlerFinished = true;
        }
        await commit.promise;
        timeline.committed = true;
        timeline.inflight = false;
        return options.result;
      },
      async purgeExpired() {
        throw new Error("poller must not purge");
      },
      async ping() {
        throw new Error("poller must not ping");
      },
      async close() {
        return undefined;
      },
    },
  };
  return timeline;
}
