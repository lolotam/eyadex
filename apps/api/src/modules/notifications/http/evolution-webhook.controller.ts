import { Body, Controller, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { Public, PublicRateLimitGuard } from "../../identity/index.ts";
import { parseEvolutionWebhook } from "../domain/evolution-webhook.ts";
import { EVOLUTION_WEBHOOK } from "../ports/tokens.ts";
import type { EvolutionWebhook } from "../use-cases/evolution-webhook/evolution-webhook.ts";
import { EvolutionWebhookGuard } from "./evolution-webhook.guard.ts";

@Controller("hooks/evolution")
@UseGuards(EvolutionWebhookGuard, PublicRateLimitGuard)
export class EvolutionWebhookController {
  constructor(@Inject(EVOLUTION_WEBHOOK) private readonly webhook: EvolutionWebhook) {}

  @Post()
  @HttpCode(200)
  @Public()
  async receive(@Body() body: unknown): Promise<void> {
    for (const event of parseEvolutionWebhook(body)) await this.webhook.apply(event);
  }
}
