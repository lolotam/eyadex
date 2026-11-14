import type { Database, IdGenerator } from "@eyadex/db";

import type { PdfClaim } from "../ports/pdf-job-store.ts";
import { claimPdfJob } from "./pg-pdf-claim.ts";

/** مخزن مهام PDF على PostgreSQL؛ غير مسجل في تركيب العامل الحالي. */
export class PgPdfJobStore {
  constructor(
    private readonly db: Database,
    private readonly ids: IdGenerator,
  ) {}

  claimNext(clinicId: string): Promise<PdfClaim> {
    return claimPdfJob(this.db, this.ids, clinicId);
  }
}
