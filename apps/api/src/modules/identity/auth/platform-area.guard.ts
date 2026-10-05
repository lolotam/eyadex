import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { ApiError } from "../../../shared/errors.ts";
import { AREA_AUTH, type AreaAuth } from "./area-auth.ts";

/**
 * بيقفل مسار على host المنصة بس: أي host تاني (حتى العيادة) → 404 قبل أي فحص جلسة، فالمسار
 * مايبانش أصلاً من منطقة العيادة. بيتحط قبل `SessionGuard`.
 */
@Injectable()
export class PlatformAreaGuard implements CanActivate {
  constructor(@Inject(AREA_AUTH) private readonly areaAuth: AreaAuth) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (this.areaAuth.hosts.resolve(request.headers) !== "platform") {
      throw new ApiError("not_found");
    }
    return true;
  }
}
