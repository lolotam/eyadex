import { expect, it } from "vitest";

import {
  EXPORT_A,
  EXPORT_B,
  LEASE_OWNER,
  deferred,
  flush,
  identity,
  queueWith,
  recordingLogger,
  sinkLogger,
} from "./export-handoff-fixtures.ts";
import type { LeasedExportIdentity } from "../ports/export-lease-handoff.ts";

const SECRET = "patient-row-secret-not-for-logs";

type Execute = (identity: LeasedExportIdentity, signal: AbortSignal) => Promise<void>;

function syncThrow(): never {
  throw new Error(SECRET);
}

interface Step {
  readonly execute: Execute;
  readonly arm?: () => Promise<void>;
  readonly release?: () => void;
}

async function recover(step: Step): Promise<void> {
  const reasons: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    reasons.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  const queue = queueWith(step.execute, { concurrency: 1 });
  try {
    queue.canClaim();
    queue.record(identity(EXPORT_A, 1));
    queue.afterClaim();
    expect(queue.canClaim()).toBe(false);
    await step.arm?.();
    if (step.arm !== undefined) expect(queue.canClaim()).toBe(false);
    step.release?.();
    await flush();
    expect(queue.canClaim()).toBe(true);
  } finally {
    step.release?.();
    process.off("unhandledRejection", onUnhandled);
    await queue.stop();
  }
  expect(reasons).toEqual([]);
}

it.each<[string, () => Step]>([
  ["rejected promise", () => ({ execute: () => Promise.reject(new Error(SECRET)) })],
  ["synchronous throw", () => ({ execute: syncThrow })],
  [
    "visible hold",
    () => {
      const started = deferred<void>();
      const release = deferred<void>();
      return {
        execute: async () => {
          started.resolve();
          await release.promise;
        },
        arm: () => started.promise,
        release: () => {
          release.resolve();
        },
      };
    },
  ],
])("occupies capacity and recovers after a %s", async (_label, build) => {
  await recover(build());
});
it("keeps capacity and avoids an unhandled rejection when the diagnostic logger throws", async () => {
  const { calls, logger } = recordingLogger(true);
  const queue = queueWith(
    async () => {
      throw new Error(SECRET);
    },
    { concurrency: 1, logger },
  );
  const reasons: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    reasons.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    queue.canClaim();
    queue.record(identity(EXPORT_A, 4));
    queue.afterClaim();
    await flush();
    expect(queue.canClaim()).toBe(true);
    expect(JSON.stringify(calls)).not.toContain(SECRET);
    expect(calls[0]?.[0]).toEqual({
      exportHandoff: {
        clinicId: identity().clinicId,
        exportId: EXPORT_A,
        attempt: 4,
        outcome: "failed",
        code: "execution_failed",
      },
    });
    expect(reasons).toEqual([]);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await queue.stop();
  }
});
it("logs only the allowlisted ids and a static code through the real logger", async () => {
  const { lines, logger } = sinkLogger();
  const queue = queueWith(
    async () => {
      throw new Error(`${SECRET} stack must stay out`);
    },
    { concurrency: 1, logger },
  );
  try {
    queue.canClaim();
    queue.record(identity(EXPORT_B, 2));
    queue.afterClaim();
    await flush();
    const text = lines.join("\n");
    expect(text).toContain(EXPORT_B);
    expect(text).toContain("execution_failed");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(LEASE_OWNER);
    expect(text).not.toContain("log message withheld");
  } finally {
    await queue.stop();
  }
});
it("rejects admission, discards an uncommitted record, and is safe to repeat", async () => {
  const seen: string[] = [];
  const queue = queueWith(async (next) => {
    seen.push(next.exportId);
  });
  queue.canClaim();
  queue.record(identity());
  const first = queue.stop();
  queue.afterClaim();
  expect(queue.canClaim()).toBe(false);
  expect(() => queue.record(identity(EXPORT_B))).toThrow("export_handoff_no_frame");
  await first;
  await queue.stop();
  await flush();
  expect(seen).toEqual([]);
  expect(queue.stop()).toBe(first);
});
it("does not finish stop until cleanup after abort is released", async () => {
  const order: string[] = [];
  const started = deferred<void>();
  const cleanup = deferred<void>();
  const queue = queueWith(async (_identity, signal) => {
    order.push("started");
    started.resolve();
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    order.push("aborted");
    await cleanup.promise;
    order.push("cleanup");
  });
  try {
    queue.canClaim();
    queue.record(identity(EXPORT_A, 1));
    queue.afterClaim();
    await started.promise;
    expect(order).toEqual(["started"]);
    const stopping = queue.stop().then(() => {
      order.push("stopped");
    });
    await flush();
    expect(order).toEqual(["started", "aborted"]);
    cleanup.resolve();
    await stopping;
    expect(order).toEqual(["started", "aborted", "cleanup", "stopped"]);
  } finally {
    started.resolve();
    cleanup.resolve();
    await queue.stop();
  }
});
it("does not start a job when stop wins before its scheduled microtask", async () => {
  const seen: string[] = [];
  const queue = queueWith(async () => {
    seen.push("started");
  });
  try {
    queue.canClaim();
    queue.record(identity(EXPORT_B, 1));
    queue.afterClaim();
    await queue.stop();
    await flush();
    expect(seen).toEqual([]);
  } finally {
    await queue.stop();
  }
});
