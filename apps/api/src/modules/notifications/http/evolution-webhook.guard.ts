import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { ApiError } from "../../../shared/errors.ts";
import { webhookAuthenticated } from "../domain/webhook-authentication.ts";
import type { EvolutionApi } from "../ports/evolution-api.ts";
import { EVOLUTION_API, EVOLUTION_WEBHOOK_SECRET } from "../ports/tokens.ts";

/** حماية آلية قبل تحليل الجسم أو rate limiter؛ لا تعتمد على جلسة المتصفح. */
@Injectable()
export class EvolutionWebhookGuard implements CanActivate {
  constructor(
    @Inject(EVOLUTION_API) private readonly evolution: EvolutionApi,
    @Inject(EVOLUTION_WEBHOOK_SECRET) private readonly secret: string | null,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.evolution.configured || this.secret === null) throw new ApiError("not_found");
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!webhookAuthenticated(request.headers["x-eyadex-webhook"], this.secret))
      throw new ApiError("unauthorized");
    return true;
  }
}
