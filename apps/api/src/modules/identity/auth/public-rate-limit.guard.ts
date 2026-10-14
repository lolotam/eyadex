import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { ApiError, ServiceUnavailableError } from "../../../shared/errors.ts";
import { AREA_AUTH, type AreaAuth } from "./area-auth.ts";
import { publicRulesFor } from "./public-rate-limits.ts";
import { AUTH_RATE_LIMIT, type AuthRateLimit } from "./rate-limit.module.ts";

// Webhooks: no browser, so no area host; each is authenticated by its own guard before this one.
const MACHINE_ROUTES: ReadonlySet<string> = new Set([
  "POST /v1/hooks/evolution",
  "POST /v1/hooks/meta",
  "GET /v1/hooks/meta",
]);

/**
 * بيعد الطلبات على `/v1` routes اللي من غير جلسة (ADR-0005/0008) قبل أي شغل داتابيز. route مش في
 * `PUBLIC_V1_ROUTES` → مرفوض؛ Redis واقع → 503، عمره ما بيعدّي.
 */
@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  constructor(
    @Inject(AREA_AUTH) private readonly areaAuth: AreaAuth,
    @Inject(AUTH_RATE_LIMIT) private readonly rateLimit: AuthRateLimit,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const routeKey = `${request.method} ${request.routeOptions.url ?? ""}`;
    // The machine endpoints authenticate their own header first; Evolution reaches an internal host and
    // Meta whichever public host its app is configured with.
    const area = MACHINE_ROUTES.has(routeKey)
      ? "clinic"
      : this.areaAuth.hosts.resolve(request.headers);
    if (area === null) throw new ApiError("not_found");
    const ip = this.areaAuth.hosts.clientIp(request.headers, request.socket.remoteAddress);
    const rules = publicRulesFor(routeKey, ip, request.body);
    if (rules === null) throw new ApiError("unknown");
    let decision;
    try {
      decision = await this.rateLimit.limiter.check(area, rules);
    } catch (exception) {
      request.log.error({ err: exception }, "rate limiter unavailable");
      throw new ServiceUnavailableError();
    }
    if (!decision.allowed) {
      void http
        .getResponse<FastifyReply>()
        .header("retry-after", String(decision.retryAfterSeconds));
      throw new ApiError("rate_limited");
    }
    return true;
  }
}
