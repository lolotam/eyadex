import { Controller, Get, Inject, Param, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { RECEIPT_PDFS } from "../ports/tokens.ts";
import type { ReceiptPdfs } from "../use-cases/receipt-pdf/receipt-pdf.ts";
import { actorOf, idOf } from "./billing-request.ts";

@Controller("payments")
export class ReceiptPdfController {
  constructor(@Inject(RECEIPT_PDFS) private readonly pdfs: ReceiptPdfs) {}

  @Get(":id/pdf")
  @Require("view:payments:branch")
  @RequiresFeature("finance")
  async open(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const { number, pdf } = await this.pdfs.open(actorOf(request), idOf(id));
    void reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="${number}.pdf"`)
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff");
    return Buffer.from(pdf);
  }
}
