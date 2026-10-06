import {
  Inject,
  Injectable,
  Optional,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { ApiError } from "../../../shared/errors.ts";
import { grantFor, type PermissionGrant } from "../domain/permission-check.ts";
import { AREA_AUTH, hasTwoFactor, toHeaders, type AreaAuth } from "../auth/area-auth.ts";
import type { AuthenticatedRequest } from "../auth/session.guard.ts";
import { accessRulesOf, type AccessRule } from "./access-rules.ts";
import {
  CLINIC_CONTEXT_RESOLVER,
  type ClinicContextResolver,
  type ClinicRequestContext,
  type ResolvedMember,
} from "./clinic-context.ts";

/** الطلب بعد `AccessGuard` على route عيادة. */
export type ClinicRequest = AuthenticatedRequest & {
  clinicContext: ClinicRequestContext;
  clinicMember: ResolvedMember["member"];
  /** النطاق اللي الصلاحية المطلوبة اتمنحت بيه (`@Require` بس). */
  permissionGrant?: PermissionGrant;
};

/** Thrown, not an envelope: a route without exactly one declaration is a bug, and it answers 500. */
export class AccessDeclarationError extends Error {
  constructor(count: number) {
    super(`route has ${count} access declarations; exactly one is required`);
    this.name = "AccessDeclarationError";
  }
}

/**
 * الـ guard العام (ADR-0009): بيشتغل قبل أي guard تاني، بالترتيب: host → جلسة → (المنصة: TOTP) →
 * عضوية نشطة → العيادة مسموح لها → [module gate، slice 5] → الصلاحية. الرفض هو الافتراضي.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Optional() @Inject(AREA_AUTH) private readonly areaAuth?: AreaAuth,
    @Optional() @Inject(CLINIC_CONTEXT_RESOLVER) private readonly resolver?: ClinicContextResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = accessRulesOf(context.getHandler());
    if (rules.length !== 1) throw new AccessDeclarationError(rules.length);
    const rule = rules[0] as AccessRule;
    if (rule.kind === "public") return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (rule.kind === "platform_staff") return this.platformStaff(request);
    await this.clinic(request as ClinicRequest, rule);
    return true;
  }

  private auth(): AreaAuth {
    // Not mounted (a test app with no auth): nothing can be verified, so nothing passes.
    if (this.areaAuth === undefined) throw new Error("access guard: auth is not mounted");
    return this.areaAuth;
  }

  private async platformStaff(request: FastifyRequest): Promise<boolean> {
    const areaAuth = this.auth();
    if (areaAuth.hosts.resolve(request.headers) !== "platform") throw new ApiError("not_found");
    const session = await areaAuth.of("platform").getSession(toHeaders(request.headers));
    if (session === null) throw new ApiError("unauthorized");
    if (!hasTwoFactor(session)) throw new ApiError("two_factor_required");
    (request as AuthenticatedRequest).areaSession = { area: "platform", session };
    return true;
  }

  private async clinic(
    request: ClinicRequest,
    rule: Exclude<AccessRule, { kind: "public" | "platform_staff" }>,
  ) {
    const areaAuth = this.auth();
    if (areaAuth.hosts.resolve(request.headers) !== "clinic") throw new ApiError("not_found");
    const session = await areaAuth.of("clinic").getSession(toHeaders(request.headers));
    if (session === null) throw new ApiError("unauthorized");
    if (this.resolver === undefined) throw new Error("access guard: clinic context not mounted");
    const { context, member } = await this.resolver.resolve(session.user.id);
    if (!this.moduleEnabled(context)) throw new ApiError("module_disabled");
    if (rule.kind === "require") {
      const grant = grantFor(context.permissions, rule.permission);
      if (grant === null) throw new ApiError("forbidden");
      request.permissionGrant = grant;
    }
    request.areaSession = { area: "clinic", session };
    request.clinicContext = context;
    request.clinicMember = member;
  }

  /** Step 3 of PRD §4.7, the module gate: slice 5 (`@RequiresFeature`) fills it in; no route is gated yet. */
  private moduleEnabled(_context: ClinicRequestContext): boolean {
    return true;
  }
}
