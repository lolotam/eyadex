import { Controller, Get, Inject, Param, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";

// The one identity import a module may make: guards and request types (CLAUDE.architecture.md §2.2).
import { ClinicAreaGuard, Public, PublicRateLimitGuard } from "../../identity/index.ts";
import { PUBLIC_INVOICE_LINKS } from "../ports/tokens.ts";
import type { PublicInvoiceLinks } from "../use-cases/public-link/public-link.ts";

// Spec §8 rule 16, R2-7: no session — the patient is not a user. The clinic host only (anything else 404),
// then the counters, so a refused or rate-limited request never reaches the database. The request log
// carries the route pattern, never the token (app.ts logCompleted).
@Controller("public/invoices")
@UseGuards(ClinicAreaGuard, PublicRateLimitGuard)
export class PublicInvoiceController {
  constructor(@Inject(PUBLIC_INVOICE_LINKS) private readonly links: PublicInvoiceLinks) {}

  @Get(":token")
  @Public()
  async open(
    @Param("token") token: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const pdf = Buffer.from(await this.links.open(token));
    // Set only once the PDF exists: a refusal leaves as the JSON envelope, never under a PDF type.
    void reply
      .header("content-type", "application/pdf")
      .header("cache-control", "no-store")
      .header("referrer-policy", "no-referrer");
    return pdf;
  }
}
