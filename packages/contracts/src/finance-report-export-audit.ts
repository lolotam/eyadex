import { z } from "zod";
import { idSchema } from "./common.ts";
import {
  REPORT_EXPORT_RANGE_MAX_DAYS,
  reportFields,
  reportIdSchema,
  reportRangeWithin,
} from "./finance-reports-rows.ts";

/** Completion metadata only: no patient set, name, note or file/storage reference. */
export const reportExportAuditDetailsSchema = z
  .object({
    report: reportIdSchema,
    from: reportFields.from,
    to: reportFields.to,
    branchIds: z.array(idSchema),
    rowCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine(reportRangeWithin(REPORT_EXPORT_RANGE_MAX_DAYS));
