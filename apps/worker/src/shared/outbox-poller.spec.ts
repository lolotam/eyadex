import type { DispatchOutcome } from "@eyadex/db";
import { describe, expect, it, vi } from "vitest";

import {
  CLAIMED,
  DEFERRED,
  FIXED_NOW,
  INTERVAL_MS,
  SEALED_MARKER,
  SHARED_TYPES,
  captureLogger,
  claimTimeline,
  countingClock,
  countingOutbox,
  deferredPromise,
  pollerFor,
  until,
} from "./__tests__/outbox-poller-fixtures.ts";
import { OutboxPoller } from "./outbox-poller.ts";

async function withClock(
  run: (hold: (poller: OutboxPoller) => void) => Promise<void>,
): Promise<void> {
  vi.useFakeTimers();
  let poller: OutboxPoller | undefined;
  try {
    await run((next) => {
      poller = next;
    });
  } finally {
    await poller?.stop();
    vi.useRealTimers();
  }
}

describe("OutboxPoller runOnce hooks", () => {
  it("calls afterClaim only after claimNext resolves, and the hook sees the committed marker", async () => {
    const handleGate = deferredPromise<DispatchOutcome>();
    const timeline = claimTimeline({
      result: { event: CLAIMED, outcome: DEFERRED },
      runHandler: true,
    });
    let handleEntered = false;
    let after = 0;
    let sawCommitted = false;
    const poller = pollerFor(timeline.outbox, {
      handle: () => {
        handleEntered = true;
        return handleGate.promise;
      },
      afterClaim: () => {
        after += 1;
        sawCommitted = timeline.committed;
      },
    });

    const once = poller.runOnce();
    await until(() => handleEntered);
    expect(after).toBe(0);
    expect(timeline.committed).toBe(false);
    expect(timeline.handlerFinished).toBe(false);

    handleGate.resolve(DEFERRED);
    await until(() => timeline.handlerFinished);
    expect(after).toBe(0);
    expect(timeline.committed).toBe(false);

    timeline.commit.resolve();
    await expect(once).resolves.toBe(true);
    expect(after).toBe(1);
    expect(sawCommitted).toBe(true);
    expect(timeline.inflight).toBe(false);
    expect(timeline.claims[0]?.types).toBe(SHARED_TYPES);
  });

  it("skips afterClaim when claimNext rejects and keeps that error", async () => {
    const boom = new Error("claim rolled back");
    const timeline = claimTimeline({ result: null });
    let after = 0;
    const once = pollerFor(timeline.outbox, {
      afterClaim: () => {
        after += 1;
      },
    }).runOnce();

    await until(() => timeline.inflight);
    timeline.commit.reject(boom);
    await expect(once).rejects.toBe(boom);
    expect(after).toBe(0);
    expect(timeline.committed).toBe(false);
  });

  it("skips afterClaim when the in-transaction handler rejects, before any commit", async () => {
    const handlerError = new Error("handler failed");
    const timeline = claimTimeline({
      result: { event: CLAIMED, outcome: DEFERRED },
      runHandler: true,
    });
    let after = 0;
    await expect(
      pollerFor(timeline.outbox, {
        handle: async () => {
          throw handlerError;
        },
        afterClaim: () => {
          after += 1;
        },
      }).runOnce(),
    ).rejects.toBe(handlerError);
    expect(after).toBe(0);
    expect(timeline.committed).toBe(false);
    expect(timeline.handlerFinished).toBe(false);
  });

  it("returns false before claimNext when canClaim is false, then claims once it is true", async () => {
    let allow = false;
    let handles = 0;
    let after = 0;
    const box = countingOutbox();
    const clock = countingClock();
    const poller = pollerFor(box.outbox, {
      handle: async (event) => {
        handles += 1;
        expect(event).toBe(CLAIMED);
        return DEFERRED;
      },
      now: clock.now,
      canClaim: () => allow,
      afterClaim: () => {
        after += 1;
      },
    });

    await expect(poller.runOnce()).resolves.toBe(false);
    expect(box.claimCalls).toEqual([]);
    expect(clock.calls).toBe(0);
    expect(handles).toBe(0);
    expect(after).toBe(0);

    allow = true;
    box.next = { event: CLAIMED, outcome: DEFERRED };
    await expect(poller.runOnce()).resolves.toBe(true);
    expect(box.claimCalls).toHaveLength(1);
    expect(box.claimCalls[0]?.types).toBe(SHARED_TYPES);
    expect(box.claimCalls[0]?.at).toEqual(FIXED_NOW);
    expect(clock.calls).toBe(1);
    expect(handles).toBe(1);
    expect(after).toBe(1);
    expect(box.committedClaims).toBe(1);
  });

  it("returns true for a claimed event and false for null when both hooks are omitted", async () => {
    const box = countingOutbox();
    box.next = { event: CLAIMED, outcome: DEFERRED };
    const poller = pollerFor(box.outbox);

    await expect(poller.runOnce()).resolves.toBe(true);
    expect(box.claimCalls[0]?.types).toBe(SHARED_TYPES);
    box.next = null;
    await expect(poller.runOnce()).resolves.toBe(false);
    expect(box.claimCalls).toHaveLength(2);
    expect(box.committedClaims).toBe(1);
  });

  it("calls afterClaim after a resolved null claim and returns false", async () => {
    const timeline = claimTimeline({ result: null });
    const clock = countingClock();
    let after = 0;
    let sawCommitted = false;
    const once = pollerFor(timeline.outbox, {
      handle: async () => {
        throw new Error("null claim must not run the handler");
      },
      now: clock.now,
      afterClaim: () => {
        after += 1;
        sawCommitted = timeline.committed;
      },
    }).runOnce();

    await until(() => timeline.inflight);
    expect(after).toBe(0);
    expect(timeline.committed).toBe(false);
    timeline.commit.resolve();
    await expect(once).resolves.toBe(false);
    expect(after).toBe(1);
    expect(sawCommitted).toBe(true);
    expect(clock.calls).toBe(1);
    expect(timeline.claims).toHaveLength(1);
  });

  it("lets an afterClaim throw escape one runOnce without claiming again", async () => {
    const box = countingOutbox();
    box.next = { event: CLAIMED, outcome: DEFERRED };
    const hookError = new Error("wake failed");
    await expect(
      pollerFor(box.outbox, {
        afterClaim: () => {
          expect(box.committedClaims).toBe(1);
          throw hookError;
        },
      }).runOnce(),
    ).rejects.toBe(hookError);
    expect(box.claimCalls).toHaveLength(1);
    expect(box.committedClaims).toBe(1);
  });
});

describe("OutboxPoller background loop", () => {
  it("sleeps the interval while canClaim is false, and stop leaves no later claim", async () => {
    await withClock(async (hold) => {
      let gates = 0;
      const box = countingOutbox();
      const poller = pollerFor(box.outbox, {
        canClaim: () => {
          gates += 1;
          return false;
        },
      });
      hold(poller);
      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(gates).toBe(1);
      expect(box.claimCalls).toEqual([]);

      await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
      expect(gates).toBe(1);
      expect(box.claimCalls).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      expect(gates).toBe(2);
      expect(box.claimCalls).toEqual([]);

      await poller.stop();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
      expect(gates).toBe(2);
      expect(box.claimCalls).toEqual([]);
    });
  });

  it("logs a post-commit hook failure and claims again only on the next interval", async () => {
    await withClock(async (hold) => {
      const box = countingOutbox();
      box.next = { event: CLAIMED, outcome: DEFERRED };
      const { lines, logger } = captureLogger();
      const poller = pollerFor(box.outbox, {
        logger,
        handle: async () => {
          box.next = null;
          return DEFERRED;
        },
        afterClaim: () => {
          throw new Error("wake failed");
        },
      });
      hold(poller);
      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(box.claimCalls).toHaveLength(1);
      expect(box.committedClaims).toBe(1);
      expect(lines).toContainEqual(
        expect.objectContaining({ msg: "outbox poll failed", err: { type: "Error" } }),
      );
      expect(JSON.stringify(lines)).not.toContain(SEALED_MARKER);

      await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
      expect(box.claimCalls).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(box.claimCalls).toHaveLength(2);
      expect(box.committedClaims).toBe(1);

      await poller.stop();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS);
      expect(box.claimCalls).toHaveLength(2);
    });
  });

  it("keeps start and stop when both hooks are omitted", async () => {
    await withClock(async (hold) => {
      const box = countingOutbox();
      box.next = { event: CLAIMED, outcome: DEFERRED };
      const poller = pollerFor(box.outbox, {
        handle: async () => {
          box.next = null;
          return DEFERRED;
        },
      });
      hold(poller);
      poller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(box.claimCalls).toHaveLength(2);
      expect(box.claimCalls[0]?.types).toBe(SHARED_TYPES);
      await poller.stop();
      await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
      expect(box.claimCalls).toHaveLength(2);
    });
  });
});
