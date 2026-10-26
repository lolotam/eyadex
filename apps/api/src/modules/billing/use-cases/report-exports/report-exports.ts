import { idSchema } from "@eyadex/contracts/common";
import { reportExportResponseSchema } from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import type { Database, Tx } from "@eyadex/db";

import { ApiError } from "../../../../shared/errors.ts";
import { appendOutboxEvent, type OutboxEvent } from "../../../../shared/outbox.ts";
import type { Clock } from "../../../tenancy/index.ts";
import type { BillingActor } from "../../domain/billing-actor.ts";
import {
  admitExportScope,
  decideExportAdmission,
  exportQueueLimit,
  parseReportExportRequest,
} from "../../domain/report-export-admission.ts";
import { reportScope } from "../../domain/report-scope.ts";
import { publishReportExportRequested } from "../../events/published.ts";
import type { BillingBranchReader } from "../../ports/billing-branches.ts";
import type { ReportExportStore } from "../../ports/report-export-store.ts";

type ReportExportResponseShape = z.infer<typeof reportExportResponseSchema>;

/** اعتماد طلب التصدير وقراءة بياناته لصاحب الطلب. مش متعمل له route لحد ما الـ worker يقدر يخلّصه. */
export class ReportExports {
  readonly #maxQueuedPerClinic: number;

  constructor(
    private readonly deps: {
      readonly db: Database;
      readonly clock: Clock;
      readonly ids: { newId(): string };
      readonly branches: BillingBranchReader;
      readonly maxQueuedPerClinic: number;
      readonly store: ReportExportStore;
      readonly append?: (tx: Tx, event: OutboxEvent) => Promise<void>;
    },
  ) {
    this.#maxQueuedPerClinic = exportQueueLimit(deps.maxQueuedPerClinic);
  }

  /**
   * بيسجّل طلب واحد. المفاتيح والعيادة والموديول فضلوا لفحص الـ HTTP لما الطريق يتركّب.
   * الصف والحدث في transaction واحدة؛ الفشل بيرجّع الاتنين.
   */
  async request(actor: BillingActor, input: unknown): Promise<ReportExportResponseShape> {
    const request = parseReportExportRequest(input);
    if (reportScope(actor, request.report) === null) throw new ApiError("forbidden");
    const now = this.deps.clock.now();
    const id = this.deps.ids.newId();
    const eventId = this.deps.ids.newId();
    const store = this.deps.store;
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      await store.lockClinic(tx, actor.clinicId);
      const branches = await this.deps.branches.listForOptions(
        tx,
        actor.clinicId,
        request.language,
      );
      const frozen = admitExportScope(
        actor,
        request,
        branches.map((branch) => branch.id),
      );
      const decision = decideExportAdmission({
        runningForMember: await store.memberHasRunning(tx, actor.clinicId, actor.membershipId),
        queuedCount: await store.countQueued(tx, actor.clinicId),
        maxQueuedPerClinic: this.#maxQueuedPerClinic,
      });
      if (decision === "busy") throw new ApiError("export_busy");
      await store.insertQueued(tx, {
        clinicId: actor.clinicId,
        id,
        requestedBy: actor.membershipId,
        report: request.report,
        params: frozen.params,
        format: request.format,
        scope: frozen.scope,
        createdAt: now,
      });
      await this.append(tx, publishReportExportRequested(eventId, actor.clinicId, now, id));
      return reportExportResponseSchema.parse({
        export: {
          id,
          report: request.report,
          format: request.format,
          status: "queued",
          createdAt: now.toISOString(),
          expiresAt: null,
          byteSize: null,
          rowCount: null,
        },
      });
    });
  }

  /**
   * بيانات العقد لصاحب الطلب. عضوية تانية أو عيادة تانية أو id بايظ كلهم `not_found`.
   * فحص التحميل وتضييق النطاق فضلوا لحارس التحميل؛ الرد مفيهوش params ولا مفتاح.
   */
  async status(actor: BillingActor, exportId: string): Promise<ReportExportResponseShape> {
    if (!idSchema.safeParse(exportId).success) throw new ApiError("not_found");
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const row = await this.deps.store.readForRequester(
        tx,
        actor.clinicId,
        actor.membershipId,
        exportId,
      );
      if (row === null) throw new ApiError("not_found");
      return reportExportResponseSchema.parse({ export: row });
    });
  }

  private append(tx: Tx, event: OutboxEvent): Promise<void> {
    return (this.deps.append ?? appendOutboxEvent)(tx, event);
  }
}
