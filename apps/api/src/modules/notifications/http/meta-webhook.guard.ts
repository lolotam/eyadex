import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { ApiError } from "../../../shared/errors.ts";
import { metaSignatureValid } from "../domain/meta-webhook.ts";
import type { MetaAppConfig } from "../persistence/meta-config.ts";
import { META_CONFIG } from "../ports/tokens.ts";
import { metaRawBody } from "./meta-raw-body.ts";

/**
 * Meta's webhook, before the public rate limiter and before any parsing: unconfigured = 404 for both
 * methods; a POST whose raw bytes do not match `X-Hub-Signature-256` = the bilingual 401. No session,
 * CSRF or origin requirement. The GET's verify token is checked by its handler (403, as Meta expects).
 */
@Injectable()
export class MetaWebhookGuard implements CanActivate {
  constructor(@Inject(META_CONFIG) private readonly config: MetaAppConfig | null) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.config === null) throw new ApiError("not_found");
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.method !== "POST") return true;
    const signature = request.headers["x-hub-signature-256"];
    if (!metaSignatureValid(metaRawBody(request), signature, this.config.appSecret))
      throw new ApiError("unauthorized");
    return true;
  }
}
