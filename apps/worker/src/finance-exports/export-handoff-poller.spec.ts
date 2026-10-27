import { describe, expect, it } from "vitest";

import { OutboxPoller } from "../shared/outbox-poller.ts";
import {
  DEFERRED,
  EXPORT_A,
  EXPORT_B,
  FIXED_NOW,
  claimedEvent,
  commitTimeline,
  flush,
  identity,
  openStep,
  silentLogger,
} from "./__tests__/export-handoff-fixtures.ts";
import { ExportHandoffQueue } from "./export-handoff-queue.ts";
import type { LeasedExportIdentity } from "./ports/export-lease-handoff.ts";

const TYPES = ["finance.report_export_requested"] as const;

function wired(options: {
  readonly execute: (identity: LeasedExportIdentity, signal: AbortSignal) => Promise<void>;
  readonly concurrency?: number;
  readonly onHandle?: () => Promise<void>;
}) {
  const timeline = commitTimeline();
  const queue = new ExportHandoffQueue({
    execute: options.execute,
    logger: silentLogger(),
    concurrency: options.concurrency ?? 1,
  });
  const poller = new OutboxPoller({
    outbox: timeline.outbox,
    types: TYPES,
    handle: async () => {
      await options.onHandle?.();
      return DEFERRED;
    },
    now: () => FIXED_NOW,
    intervalMs: 5_000,
    logger: silentLogger(),
    canClaim: queue.canClaim,
    afterClaim: queue.afterClaim,
  });
  return { timeline, queue, poller };
}

describe("export handoff through OutboxPoller", () => {
  it("does not start work before commit, and slow work does not hold runOnce", async () => {
    let entered = 0;
    let release: (() => void) | undefined;
    const { timeline, queue, poller } = wired({
      execute: async () => {
        entered += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      onHandle: async () => {
        queue.record(identity(EXPORT_A, 1));
      },
    });
    const step = openStep(true);
    timeline.claims.push(step);
    try {
      const once = poller.runOnce();
      await flush();
      expect(step.handlerFinished).toBe(true);
      expect(step.committed).toBe(false);
      expect(entered).toBe(0);

      step.commit.resolve();
      expect(entered).toBe(0);
      await expect(once).resolves.toBe(true);
      expect(step.committed).toBe(true);
      expect(entered).toBe(1);
      expect(queue.canClaim()).toBe(false);
    } finally {
      release?.();
      await queue.stop();
      await poller.stop();
    }
  });
  it("does not start an identity recorded by a handler that then rejects", async () => {
    const seen: string[] = [];
    const { timeline, queue, poller } = wired({
      execute: async (next) => {
        seen.push(next.exportId);
      },
      onHandle: async () => {
        queue.record(identity(EXPORT_A, 2));
        throw new Error("handler rejected");
      },
    });
    timeline.claims.push(openStep(true), openStep(false, null));
    try {
      await expect(poller.runOnce()).rejects.toThrow("handler rejected");
      expect(timeline.claims[0]?.handlerFinished).toBe(false);
      expect(timeline.claims[0]?.committed).toBe(false);
      const empty = poller.runOnce();
      timeline.claims[1]?.commit.resolve();
      await expect(empty).resolves.toBe(false);
      await flush();
      expect(seen).toEqual([]);
    } finally {
      await queue.stop();
      await poller.stop();
    }
  });
  it("drops a recorded identity when commit rejects, then on an empty claim and a different claim", async () => {
    const seen: string[] = [];
    const pending = [identity(EXPORT_A, 1), identity(EXPORT_B, 3)];
    const { timeline, queue, poller } = wired({
      execute: async (next) => {
        seen.push(`${next.exportId}:${next.attempt}`);
      },
      onHandle: async () => {
        const next = pending.shift();
        if (next !== undefined) queue.record(next);
      },
    });
    const rolled = openStep(true, claimedEvent(EXPORT_A));
    const empty = openStep(false, null);
    const later = openStep(true, claimedEvent(EXPORT_B));
    timeline.claims.push(rolled, empty, later);
    try {
      const once = poller.runOnce();
      await flush();
      expect(rolled.handlerFinished).toBe(true);
      expect(rolled.committed).toBe(false);
      expect(seen).toEqual([]);
      rolled.commit.reject(new Error("claim commit rejected"));
      await expect(once).rejects.toThrow("claim commit rejected");
      await flush();
      expect(rolled.committed).toBe(false);
      expect(seen).toEqual([]);
      empty.commit.resolve();
      await expect(poller.runOnce()).resolves.toBe(false);
      await flush();
      expect(empty.committed).toBe(true);
      expect(seen).toEqual([]);
      const next = poller.runOnce();
      await flush();
      expect(later.handlerFinished).toBe(true);
      expect(seen).toEqual([]);
      later.commit.resolve();
      await expect(next).resolves.toBe(true);
      await flush();
      expect(seen).toEqual([`${EXPORT_B}:3`]);
    } finally {
      await queue.stop();
      await poller.stop();
    }
  });
  it("does not claim while local jobs are at N, then claims again after the job settles", async () => {
    let release: (() => void) | undefined;
    const { timeline, queue, poller } = wired({
      concurrency: 1,
      execute: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      onHandle: async () => {
        queue.record(identity(EXPORT_A, 1));
      },
    });
    timeline.claims.push(openStep(true), openStep(true, claimedEvent(EXPORT_B)));
    try {
      const first = poller.runOnce();
      await flush();
      timeline.claims[0]?.commit.resolve();
      await expect(first).resolves.toBe(true);
      expect(timeline.claimCalls).toBe(1);

      await expect(poller.runOnce()).resolves.toBe(false);
      expect(timeline.claimCalls).toBe(1);
      expect(timeline.claims[1]?.handlerFinished).toBe(false);

      release?.();
      await flush();
      const second = poller.runOnce();
      await flush();
      expect(timeline.claimCalls).toBe(2);
      timeline.claims[1]?.commit.resolve();
      await expect(second).resolves.toBe(true);
    } finally {
      release?.();
      await queue.stop();
      await poller.stop();
    }
  });
});
