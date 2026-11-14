import type { Database, IdGenerator } from "@eyadex/db";

import type { PdfFailureCode } from "../domain/pdf-job-failure.ts";
import type { PdfClaim, PdfFenceAnswer, PdfJobFence, PdfJobStore } from "../ports/pdf-job-store.ts";
import { claimPdfJob } from "./pg-pdf-claim.ts";
import { failPdfJob, heartbeatPdfJob } from "./pg-pdf-fence.ts";

/** مخزن مهام PDF على PostgreSQL؛ غير مسجل في تركيب العامل الحالي. */
export class PgPdfJobStore implements PdfJobStore {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
  ) {}

  claimNext(clinicId: string): Promise<PdfClaim> {
    return claimPdfJob(this.db, this.ids, clinicId);
  }

  heartbeat(fence: PdfJobFence): Promise<PdfFenceAnswer> {
    return heartbeatPdfJob(this.db, fence);
  }

  recordFailure(fence: PdfJobFence, code: PdfFailureCode): Promise<PdfFenceAnswer> {
    return failPdfJob(this.db, fence, code);
  }
}
