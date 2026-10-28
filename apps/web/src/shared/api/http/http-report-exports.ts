import * as reports from "@eyadex/contracts/finance-reports";
import type { ReportExportsApi } from "../reports-client";
import type { HttpContext } from "./http-context";

const BASE = "/v1/finance-reports/exports";
const at = (exportId: string) => `${BASE}/${encodeURIComponent(exportId)}`;

/**
 * The F3 export routes. Bodies and queries go as typed (the API alone answers
 * `report_range_too_long` or `validation`); every JSON answer is parsed by its contract schema,
 * and the download is the file's bytes through the transport.
 */
export function createHttpReportExports({ transport }: HttpContext): ReportExportsApi {
  return {
    requestExport: (_persona, body) =>
      transport.send("POST", BASE, { schema: reports.reportExportResponseSchema, body }),
    listExports: (_persona, query) =>
      transport.send("GET", BASE, {
        schema: reports.reportExportListResponseSchema,
        query: { limit: query.limit, cursor: query.cursor },
      }),
    getExport: (_persona, exportId) =>
      transport.send("GET", at(exportId), { schema: reports.reportExportResponseSchema }),
    downloadExport: (_persona, exportId) => transport.download(`${at(exportId)}/download`),
  };
}
