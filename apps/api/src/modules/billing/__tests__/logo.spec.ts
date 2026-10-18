import type { Database, Tx } from "@eyadex/db";
import { describe, expect, it } from "vitest";

import { BlobStoreAnswerError, type BlobStore } from "../../../shared/blob/blob-store.ts";
import { ServiceUnavailableError } from "../../../shared/errors.ts";
import { ClinicFinanceSettings } from "../use-cases/settings/settings.ts";

const settings = (error: Error) =>
  new ClinicFinanceSettings({
    db: {
      withTenant: (_id: string, run: (tx: Tx) => unknown) =>
        run({
          execute: async () => [{ logo_blob_key: "clinic/test/logo/missing" }],
        } as unknown as Tx),
    } as unknown as Database,
    clock: { now: () => new Date() },
    ids: { newId: () => "unused" },
    blobs: {
      put: async () => {},
      get: async () => {
        throw error;
      },
    } satisfies BlobStore,
  });

describe("a stored clinic logo with no blob", () => {
  it("answers not_found while store outages and other answers keep their errors", async () => {
    await expect(
      settings(new BlobStoreAnswerError("download", "not found")).logo("clinic"),
    ).rejects.toMatchObject({ code: "not_found" });
    const unavailable = new ServiceUnavailableError();
    await expect(settings(unavailable).logo("clinic")).rejects.toBe(unavailable);
    const forbidden = new BlobStoreAnswerError("download", "status 403");
    await expect(settings(forbidden).logo("clinic")).rejects.toBe(forbidden);
  });
});
