import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { ApiError } from "../../../shared/errors.ts";
import { Public, PublicRateLimitGuard } from "../../identity/index.ts";
import { metaChallenge } from "../domain/meta-webhook.ts";
import type { MetaAppConfig } from "../persistence/meta-config.ts";
import { META_CONFIG, META_WEBHOOK } from "../ports/tokens.ts";
import type { MetaWebhook } from "../use-cases/meta-webhook/meta-webhook.ts";
import { metaRawBody } from "./meta-raw-body.ts";
import { MetaWebhookGuard } from "./meta-webhook.guard.ts";

// Phase 3 N3 (spec §7.2): Meta's app webhook. Machine endpoints: the guard answers 404 when Meta is not
// configured and authenticates the POST's raw bytes before the rate limiter; the body is never logged.
@Controller("hooks/meta")
@UseGuards(MetaWebhookGuard, PublicRateLimitGuard)
export class MetaWebhookController {
  constructor(
    @Inject(META_WEBHOOK) private readonly webhook: MetaWebhook,
    @Inject(META_CONFIG) private readonly config: MetaAppConfig | null,
  ) {}

  // Meta's subscription check: the challenge back as plain text, or 403.
  @Get()
  @Public()
  verify(@Query() query: unknown, @Res() reply: FastifyReply): void {
    const challenge = this.config === null ? null : metaChallenge(query, this.config.verifyToken);
    if (challenge === null) throw new ApiError("forbidden");
    void reply.code(200).header("content-type", "text/plain; charset=utf-8").send(challenge);
  }

  // Signed already (MetaWebhookGuard). A body that is not JSON carries no status: ignored with 200.
  @Post()
  @HttpCode(200)
  @Public()
  async receive(@Req() request: FastifyRequest): Promise<void> {
    let body: unknown;
    try {
      body = JSON.parse(metaRawBody(request).toString("utf8"));
    } catch {
      return;
    }
    await this.webhook.receive(body);
  }
}
