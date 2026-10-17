import { Controller, Get, Inject, Param, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";

// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { INVOICE_PDFS } from "../ports/tokens.ts";
import type { InvoicePdfs } from "../use-cases/invoice-pdf/invoice-pdf.ts";
import { actorOf, idOf } from "./billing-request.ts";

// Spec §3.3: the invoice page's «PDF / طباعة». view:invoices:own admits every scope; the use case narrows.
@Controller("invoices")
export class InvoicePdfController {
  constructor(@Inject(INVOICE_PDFS) private readonly pdfs: InvoicePdfs) {}

  @Get(":id/pdf")
  @Require("view:invoices:own")
  @RequiresFeature("finance")
  async open(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const { number, pdf } = await this.pdfs.open(actorOf(request), idOf(id));
    // Set only once the PDF exists: a refusal leaves as the JSON envelope, never under a PDF type.
    void reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="${number}.pdf"`)
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff");
    return Buffer.from(pdf);
  }
}
