import { idSchema } from "@eyadex/contracts/common";
import { parseFrozenReportExportParams } from "@eyadex/contracts/finance-reports-export";
import {
  reportPermissionScope,
  reportScopeSupported,
} from "@eyadex/contracts/finance-report-access";
import { viewScopeCovers } from "@eyadex/contracts/permissions";
import type { Database } from "@eyadex/db";
import type { FieldCipher } from "@eyadex/secrets";

import { ApiError } from "../../../../shared/errors.ts";
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
  constructor(
    private readonly deps: {
      db: Database;
      access: ReportExportAccessReader;
      files: ReportExportFiles;
      patients: BillingPatientReader;
      branches: BillingBranchReader;
      cipher: Pick<FieldCipher, "openBytes">;
    },
  ) {}

  async download(actor: BillingActor, id: string) {
    if (!idSchema.safeParse(id).success) throw new ApiError("not_found");
    const first = await this.#check(actor, id);
    if (first.purge) {
      await this.#purge(actor.clinicId, first.row);
      throw new ApiError("not_found");
    }
    const stored = await this.deps.files.get(first.row.storage_key!);
    const bytes = ["outstanding", "patient_credit", "refunds", "discounts"].includes(
      first.row.report,
    )
      ? this.deps.cipher.openBytes(
          actor.clinicId,
          { table: "finance_report_exports", column: "blob", rowId: `${id}:${first.row.attempt}` },
          stored.toString("utf8"),
        )
      : stored;
    const final = await this.#check(actor, id);
    if (final.purge) {
      await this.#purge(actor.clinicId, final.row);
      throw new ApiError("not_found");
    }
    if (
      first.row.attempt !== final.row.attempt ||
      first.row.storage_key !== final.row.storage_key
    ) {
      throw new ApiError("not_found");
    }
    return { bytes: Buffer.from(bytes), format: first.row.format };
  }

  async #check(actor: BillingActor, id: string) {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const row = await readDownloadExport(tx, actor.clinicId, actor.membershipId, id);
      if (row === null || row.status !== "done" || !row.unexpired) throw new ApiError("not_found");
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
      if (row.scope === "own" && row.patient_ids === null) throw new ApiError("not_found");
      const purge =
        row.scope === "own" &&
        !(await ownExportStillReachable(
          tx,
          actor.membershipId,
          row.patient_ids!,
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
