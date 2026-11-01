import { idSchema } from "@eyadex/contracts/common";
import { parseFrozenReportExportParams } from "@eyadex/contracts/finance-reports-export";
import {
  reportPermissionScope,
  reportScopeSupported,
} from "@eyadex/contracts/finance-report-access";
import { viewScopeCovers } from "@eyadex/contracts/permissions";
import type { Database } from "@eyadex/db";
import { SealedFile, type FieldCipher } from "@eyadex/secrets";
import { Readable } from "node:stream";

import { ServiceUnavailableError, ApiError } from "../../../../shared/errors.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import type { BillingPatientReader } from "../../ports/billing-patients.ts";
import type { BillingBranchReader } from "../../ports/billing-branches.ts";
import type {
  ReportExportAccessReader,
  ReportExportFiles,
} from "../../ports/report-export-access.ts";
import {
  exportClinicAllowed,
  markExportPurged,
  ownExportStillReachable,
  readDownloadExport,
  type DownloadExportRow,
} from "../../persistence/pg-report-export-download.ts";

/** Download is checked before storage I/O and again afterwards, so an in-flight revocation wins. */
export class DownloadReportExport {
  readonly #active = new Map<AbortController, Promise<void>>();
  #stopping = false;
  constructor(
    private readonly deps: {
      db: Database;
      access: ReportExportAccessReader;
      files: ReportExportFiles;
      patients: BillingPatientReader;
      branches: BillingBranchReader;
      cipher: FieldCipher;
      maxDownloads?: number;
    },
  ) {
    const count = deps.maxDownloads ?? 2;
    if (!Number.isSafeInteger(count) || count < 1 || count > 32)
      throw new Error("invalid_export_download_concurrency");
  }

  async download(actor: BillingActor, id: string, signal = new AbortController().signal) {
    if (!idSchema.safeParse(id).success) throw new ApiError("not_found");
    const first = await this.#check(actor, id);
    if (first.purge) {
      await this.#purge(actor.clinicId, first.row);
      throw new ApiError("not_found");
    }
    if (this.#stopping || this.#active.size >= (this.deps.maxDownloads ?? 2))
      throw new ServiceUnavailableError();
    signal.throwIfAborted();
    const control = new AbortController();
    const stop = () => control.abort();
    signal.addEventListener("abort", stop, { once: true });
    let finished = () => {};
    this.#active.set(
      control,
      new Promise<void>((resolve) => {
        finished = resolve;
      }),
    );
    let artifact: SealedFile | undefined;
    let stream: Readable | undefined;
    let cleanup: Promise<void> | undefined;
    const release = () =>
      (cleanup ??= (async () => {
        try {
          stream?.destroy();
          await artifact?.dispose();
        } finally {
          signal.removeEventListener("abort", stop);
          this.#active.delete(control);
          finished();
        }
      })());
    control.signal.addEventListener(
      "abort",
      () => {
        stream?.destroy();
      },
      { once: true },
    );
    try {
      const source = await this.deps.files.get(first.row.storage_key!, control.signal);
      let byteSize: number;
      try {
        artifact = await SealedFile.receive(
          source,
          this.deps.cipher,
          actor.clinicId,
          { table: "finance_report_exports", column: "blob", rowId: `${id}:${first.row.attempt}` },
          control.signal,
          Number(first.row.byte_size),
        );
        byteSize = await artifact.verify(control.signal);
      } catch {
        control.signal.throwIfAborted();
        throw new ServiceUnavailableError();
      }
      const final = await this.#check(actor, id);
      if (final.purge) {
        await this.#purge(actor.clinicId, final.row);
        throw new ApiError("not_found");
      }
      if (
        first.row.attempt !== final.row.attempt ||
        first.row.storage_key !== final.row.storage_key
      )
        throw new ApiError("not_found");
      control.signal.throwIfAborted();
      stream = Readable.from(artifact.plaintext(control.signal), {
        highWaterMark: 65_536,
        objectMode: false,
      });
      stream.once("close", () => {
        void release().catch(() => undefined);
      });
      return { stream, byteSize, format: first.row.format, release };
    } catch (error) {
      await release();
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.#stopping = true;
    for (const control of this.#active.keys()) control.abort();
    await Promise.all([...this.#active.values()]);
  }

  async #check(actor: BillingActor, id: string) {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const row = await readDownloadExport(tx, actor.clinicId, actor.membershipId, id);
      if (row === null || row.status !== "done" || !row.unexpired) throw new ApiError("not_found");
      if (!Number.isSafeInteger(Number(row.byte_size)) || Number(row.byte_size) < 1)
        throw new ApiError("not_found");
      const expectedKey = `clinic/${actor.clinicId}/finance-exports/${id}/${row.attempt}.${row.format}`;
      if (row.storage_key !== expectedKey) throw new ApiError("not_found");
      const access = await this.deps.access.read(tx, actor.clinicId, actor.userId);
      if (
        access === null ||
        !access.active ||
        !access.roleActive ||
        access.membershipId !== actor.membershipId
      )
        throw new ApiError("account_disabled");
      if (!(await exportClinicAllowed(tx, access.clinicStatus, access.expiresAt)))
        throw new ApiError("subscription_blocked");
      if (!access.financeEnabled) throw new ApiError("module_disabled");
      const scope = reportPermissionScope(access.permissions, row.report);
      if (scope === null) throw new ApiError("forbidden");
      if (!reportScopeSupported(row.report, row.scope) || !viewScopeCovers(scope, row.scope))
        throw new ApiError("not_found");
      const params = parseFrozenReportExportParams(row.report, row.format, row.params);
      if (params === null) throw new ApiError("not_found");
      const branches = await this.deps.branches.listForOptions(tx, actor.clinicId, params.language);
      const available = new Set(branches.map((b) => b.id));
      if (
        params.branchIds.some(
          (branch) =>
            !available.has(branch) ||
            (scope === "branch" && !access.allBranches && !access.branchIds.includes(branch)),
        )
      )
        throw new ApiError("not_found");
      if (row.scope === "own" && !row.has_patient_set) throw new ApiError("not_found");
      const purge =
        row.scope === "own" &&
        !(await ownExportStillReachable(
          tx,
          actor.clinicId,
          actor.membershipId,
          row,
          this.deps.patients,
        ));
      // The DB clock is read after the scope/patient lookups, which can themselves wait on locks.
      const current = await readDownloadExport(tx, actor.clinicId, actor.membershipId, id);
      if (
        current?.status !== "done" ||
        !current.unexpired ||
        current.storage_key !== row.storage_key
      )
        throw new ApiError("not_found");
      return { row, purge };
    });
  }

  async #purge(clinicId: string, row: DownloadExportRow) {
    await this.deps.files.delete(row.storage_key!);
    await this.deps.db.withTenant(clinicId, (tx) => markExportPurged(tx, clinicId, row));
  }
}
