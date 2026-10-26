import type { ClaimedEvent } from "@eyadex/db";
import type { Logger } from "@eyadex/observability";
import { describe, expect, it, vi } from "vitest";

import { FINANCE_REPORT_EXPORT_REQUESTED } from "./domain/export-event.ts";
import { handleExportRequested } from "./handle-export-requested.ts";
import type { ExportLeaseHandoff } from "./ports/export-lease-handoff.ts";
import type { ClaimDecision, ExportClaimPort } from "./ports/export-store.ts";

const clinicId = "11111111-1111-4111-8111-111111111111";
const exportId = "22222222-2222-4222-8222-222222222222";
const logger = { error() {}, info() {} } as unknown as Logger;

function event(patch: Partial<ClaimedEvent> = {}): ClaimedEvent {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    clinicId,
    type: FINANCE_REPORT_EXPORT_REQUESTED,
    payload: { exportId },
    attempts: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...patch,
  };
}

function harness(decision: ClaimDecision) {
  const decideClaim = vi.fn(async () => decision);
  const record = vi.fn();
  const claims: ExportClaimPort = { decideClaim };
  const handoff: ExportLeaseHandoff = { record };
  const handle = handleExportRequested({ claims, handoff, leaseOwner: "worker-a", logger });
  return { handle, decideClaim, record };
}

describe("handleExportRequested", () => {
  it("fails malformed payloads without calling the store or recording a handoff", async () => {
    const { handle, decideClaim, record } = harness({
      kind: "leased",
      attempt: 1,
      leaseUntil: new Date(),
    });
    await expect(handle(event({ type: "other.event" }))).resolves.toEqual({
      kind: "failed",
      error: "invalid_payload",
    });
    await expect(handle(event({ clinicId: null }))).resolves.toEqual({
      kind: "failed",
      error: "invalid_payload",
    });
    await expect(handle(event({ payload: { exportId: "bad", extra: true } }))).resolves.toEqual({
      kind: "failed",
      error: "invalid_payload",
    });
    expect(decideClaim).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("returns deferred at the lease end and records only the leased identity", async () => {
    const leaseUntil = new Date("2026-04-01T00:01:00.000Z");
    const { handle, decideClaim, record } = harness({ kind: "leased", attempt: 2, leaseUntil });
    await expect(handle(event())).resolves.toEqual({ kind: "deferred", nextAttemptAt: leaseUntil });
    expect(decideClaim).toHaveBeenCalledWith({ clinicId, exportId, leaseOwner: "worker-a" });
    expect(record).toHaveBeenCalledWith({ clinicId, exportId, attempt: 2, leaseOwner: "worker-a" });
    expect(record.mock.calls[0]?.[0]).not.toHaveProperty("report");
    expect(record.mock.calls[0]?.[0]).not.toHaveProperty("storageKey");
  });

  it("does not record a handoff when the claim does not take the lease", async () => {
    const until = new Date("2026-04-01T00:00:30.000Z");
    const busy = harness({ kind: "deferred", nextAttemptAt: until });
    await expect(busy.handle(event())).resolves.toEqual({ kind: "deferred", nextAttemptAt: until });
    expect(busy.record).not.toHaveBeenCalled();
    const closed = harness({ kind: "dispatched" });
    await expect(closed.handle(event())).resolves.toEqual({ kind: "dispatched" });
    const failed = harness({ kind: "failed", error: "attempts_exhausted" });
    await expect(failed.handle(event())).resolves.toEqual({
      kind: "failed",
      error: "attempts_exhausted",
    });
    expect(closed.record).not.toHaveBeenCalled();
    expect(failed.record).not.toHaveBeenCalled();
  });
});
