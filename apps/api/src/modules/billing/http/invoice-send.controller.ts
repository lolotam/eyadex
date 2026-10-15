import { Body, Controller, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import {
  sendInvoiceRequestSchema,
  type SendInvoiceRequest,
  type SendInvoiceResponse,
} from "@eyadex/contracts/finance";

import { ZodValidationPipe } from "../../../shared/zod-validation.pipe.ts";
// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { Require, RequiresFeature, type ClinicRequest } from "../../identity/index.ts";
import { INVOICE_SENDS } from "../ports/tokens.ts";
import type { InvoiceSends } from "../use-cases/invoice-send/invoice-send.ts";
import { actorOf, idOf } from "./billing-request.ts";

// Spec §3.3: sending needs the view key only. A replayed sendRequestId answers 200 with the first row, so the
// first answer is 200 too and a client cannot tell a retry from a first press.
@Controller("invoices")
export class InvoiceSendController {
  constructor(@Inject(INVOICE_SENDS) private readonly sends: InvoiceSends) {}

  @Post(":id/send")
  @HttpCode(200)
  @Require("view:invoices:own")
  @RequiresFeature("finance")
  send(
    @Req() request: ClinicRequest,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(sendInvoiceRequestSchema)) body: SendInvoiceRequest,
  ): Promise<SendInvoiceResponse> {
    return this.sends.send(actorOf(request), idOf(id), body);
  }
}
