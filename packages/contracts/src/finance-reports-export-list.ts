import { z } from "zod";
import { idSchema } from "./common.ts";

/** The requester's export history; cursors are export ids, never report contents. */
export const reportExportListQuerySchema = z
  .object({
    cursor: idSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type ReportExportListQuery = z.infer<typeof reportExportListQuerySchema>;
