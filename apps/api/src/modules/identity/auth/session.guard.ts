import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { ApiError } from "../../../shared/errors.ts";
import { AREA_AUTH, hasTwoFactor, toHeaders, type AreaAuth, type ResolvedSession } from "./area-auth.ts";

/** الطلب بعد `SessionGuard`: الجلسة جاهزة للـ guards اللي بعده. */
export type AuthenticatedRequest = FastifyRequest & { areaSession: ResolvedSession };

/**
 * Guard لمسارات `/v1`: host مجهول → 404، مفيش جلسة من نفس المنطقة → 401، جلسة منصة من غير TOTP →
 * 403 `two_factor_required`. TODO(spec): فحص تعطيل العضوية والاشتراك بييجي مع الـ slice بتاعه.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AREA_AUTH) private readonly areaAuth: AreaAuth) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const area = this.areaAuth.hosts.resolve(request.headers);
    if (area === null) throw new ApiError("not_found");
    const session = await this.areaAuth.of(area).getSession(toHeaders(request.headers));
    if (session === null) throw new ApiError("unauthorized");
    if (area === "platform" && !hasTwoFactor(session)) throw new ApiError("two_factor_required");
    (request as AuthenticatedRequest).areaSession = { area, session };
    return true;
  }
}
