import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  EXPORT_A,
  EXPORT_B,
  LEASE_OWNER,
  flush,
  identity,
  queueWith,
  silentLogger,
} from "./__tests__/export-handoff-fixtures.ts";
import "./__tests__/export-handoff-lifecycle.ts";
import { ExportHandoffQueue } from "./export-handoff-queue.ts";
import type { LeasedExportIdentity } from "./ports/export-lease-handoff.ts";

const PRIVATE_ROW_MARKER = `synthetic-row-${randomUUID()}`;

describe("ExportHandoffQueue config", () => {
  it("rejects a missing callback and a concurrency that is not a positive safe integer", () => {
    expect(() => new ExportHandoffQueue({ logger: silentLogger() } as never)).toThrow(
      "export_handoff_execute_required",
    );
    for (const concurrency of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => queueWith(async () => undefined, { concurrency })).toThrow(
        "export_handoff_concurrency_invalid",
      );
    }
  });

  it("defaults concurrency to 2 and counts a scheduled job toward that cap", async () => {
    const seen: string[] = [];
    const queue = queueWith(async (next) => {
      seen.push(next.exportId);
    });
    try {
      queue.canClaim();
      queue.record(identity(EXPORT_A));
      queue.afterClaim();
      queue.canClaim();
      queue.record(identity(EXPORT_B));
      queue.afterClaim();
      expect(queue.canClaim()).toBe(false);
      expect(seen).toEqual([]);
    } finally {
      await queue.stop();
    }
  });
});

describe("ExportHandoffQueue record", () => {
  it("fails a record outside a frame and does not run it later", async () => {
    const seen: LeasedExportIdentity[] = [];
    const queue = queueWith(async (next) => {
      seen.push(next);
    });
    try {
      expect(() => queue.record(identity())).toThrow("export_handoff_no_frame");
      queue.afterClaim();
      await flush();
      expect(seen).toEqual([]);
    } finally {
      await queue.stop();
    }
  });

  it("keeps the first record when a second record in the same frame throws", async () => {
    const seen: string[] = [];
    const queue = queueWith(async (next) => {
      seen.push(next.exportId);
    });
    try {
      queue.canClaim();
      queue.record(identity(EXPORT_A));
      expect(() => queue.record(identity(EXPORT_B))).toThrow("export_handoff_already_recorded");
      queue.afterClaim();
      await flush();
      expect(seen).toEqual([EXPORT_A]);
    } finally {
      await queue.stop();
    }
  });

  it("does not retain an identity when copying the record throws", async () => {
    const seen: string[] = [];
    const queue = queueWith(async (next) => {
      seen.push(next.exportId);
    });
    const evil = new Proxy(identity(EXPORT_B), {
      get(target, prop, receiver) {
        if (prop === "leaseOwner") throw new Error(PRIVATE_ROW_MARKER);
        return Reflect.get(target, prop, receiver);
      },
    });
    try {
      queue.canClaim();
      expect(() => queue.record(evil)).toThrow("export_handoff_record_invalid");
      queue.afterClaim();
      await flush();
      expect(seen).toEqual([]);
    } finally {
      await queue.stop();
    }
  });

  it("does not run a recorded identity when the claim throws before afterClaim", async () => {
    const seen: string[] = [];
    const queue = queueWith(async (next) => {
      seen.push(next.exportId);
    });
    try {
      queue.canClaim();
      queue.record(identity(EXPORT_A, 1));
      queue.canClaim();
      queue.afterClaim();
      await flush();
      expect(seen).toEqual([]);
    } finally {
      await queue.stop();
    }
  });

  it("hands off a copy of the four primitives and ignores later caller mutation and extra fields", async () => {
    const seen: LeasedExportIdentity[] = [];
    const queue = queueWith(async (next) => {
      seen.push(next);
    });
    const input = {
      ...identity(EXPORT_A, 3),
      payload: PRIVATE_ROW_MARKER,
      rows: [PRIVATE_ROW_MARKER],
      name: "synthetic-patient",
    };
    try {
      queue.canClaim();
      queue.record(input);
      input.clinicId = "mutated-clinic";
      input.exportId = "mutated-export";
      input.attempt = 9;
      input.leaseOwner = "mutated-owner";
      queue.afterClaim();
      await flush();
      expect(seen).toEqual([
        { clinicId: identity().clinicId, exportId: EXPORT_A, attempt: 3, leaseOwner: LEASE_OWNER },
      ]);
      expect(seen[0]).not.toHaveProperty("payload");
      expect(seen[0]).not.toHaveProperty("name");
    } finally {
      await queue.stop();
    }
  });
});

describe("ExportHandoffQueue wake", () => {
  it("does not run the callback synchronously from afterClaim, and an empty claim creates no job", async () => {
    let entered = 0;
    const queue = queueWith(
      async () => {
        entered += 1;
      },
      { concurrency: 1 },
    );
    try {
      queue.canClaim();
      queue.afterClaim();
      queue.canClaim();
      queue.record(identity());
      queue.afterClaim();
      expect(entered).toBe(0);
      expect(queue.canClaim()).toBe(false);
      await Promise.resolve();
      expect(entered).toBe(1);
      queue.afterClaim();
      await flush();
      expect(entered).toBe(1);
    } finally {
      await queue.stop();
    }
  });

  it("does not start a second job for the same active identity", async () => {
    let entered = 0;
    const queue = queueWith(
      async (_identity, signal) => {
        entered += 1;
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          else signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
      { concurrency: 2 },
    );
    try {
      queue.canClaim();
      queue.record(identity(EXPORT_A, 1));
      queue.afterClaim();
      queue.canClaim();
      queue.record(identity(EXPORT_A, 1));
      queue.afterClaim();
      await flush();
      expect(entered).toBe(1);
      expect(queue.canClaim()).toBe(true);
    } finally {
      await queue.stop();
    }
  });
});
