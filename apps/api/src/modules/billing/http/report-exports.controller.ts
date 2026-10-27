import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import * as reports from "@eyadex/contracts/finance-reports";
import type { z } from "zod";
import type { FastifyReply } from "fastify";
import { Authenticated, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
import { actorOf, idOf } from "./billing-request.ts";
import type { ReportExports } from "../use-cases/report-exports/report-exports.ts";
import type { DownloadReportExport } from "../use-cases/report-exports/download-report-export.ts";

export const REPORT_EXPORTS = Symbol("billing.ReportExports");
export const DOWNLOAD_REPORT_EXPORT = Symbol("billing.DownloadReportExport");
export const REPORT_EXPORT_FILES = Symbol("billing.ReportExportFiles");

@Controller("finance-reports/exports")
export class ReportExportsController {
  constructor(
    @Inject(REPORT_EXPORTS) private readonly exports: ReportExports,
    @Inject(DOWNLOAD_REPORT_EXPORT) private readonly downloads: DownloadReportExport,
  ) {}

  @Post()
  @HttpCode(202)
  @Authenticated()
  @RequiresFeature("finance")
  request(@Req() request: ClinicRequest, @Body() body: unknown) {
    return this.exports.request(actorOf(request), body);
  }

  @Get()
  @Authenticated()
  @RequiresFeature("finance")
  list(
    @Req() request: ClinicRequest,
    @Query(new ZodValidationPipe(reports.reportExportListQuerySchema))
    query: z.infer<typeof reports.reportExportListQuerySchema>,
  ) {
    return this.exports.list(actorOf(request), query);
  }

  @Get(":id")
  @Authenticated()
  @RequiresFeature("finance")
  status(@Req() request: ClinicRequest, @Param("id") id: string) {
    return this.exports.status(actorOf(request), idOf(id));
  }

  @Get(":id/download")
  @Authenticated()
  @RequiresFeature("finance")
  async download(
    @Req() request: ClinicRequest,
    @Param("id") raw: string,
    @Res() reply: FastifyReply,
  ) {
    const id = idOf(raw);
    const file = await this.downloads.download(actorOf(request), id);
    return reply
      .header("cache-control", "private, no-store")
      .header("x-content-type-options", "nosniff")
      .header("content-disposition", `attachment; filename="finance-report-${id}.${file.format}"`)
      .type(
        file.format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .send(file.bytes);
  }
}
