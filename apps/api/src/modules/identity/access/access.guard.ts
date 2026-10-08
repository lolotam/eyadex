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
import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";
import type { ClinicModule } from "@eyadex/contracts/clinics";

import { PLATFORM_ACCOUNT_GATE, type PlatformAccountGate } from "../ports/platform-account-gate.ts";
import { accessRulesOf, featureOf, type AccessRule } from "./access-rules.ts";
import {
  CLINIC_CONTEXT_RESOLVER,
  type ClinicContextResolver,
  type ClinicRequestContext,
  type ResolvedMember,
} from "./clinic-context.ts";

const MODULE_OF: ReadonlyMap<string, ClinicModule | null> = new Map(
  PERMISSION_CATALOG.map((p) => [p.key, p.module]),
);

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
 * الـ guard العام (ADR-0009): بيشتغل قبل أي guard تاني، بالترتيب: host → جلسة → (المنصة: TOTP ثم
 * حساب فريق نشط، ADR-0020) →
 * عضوية نشطة → العيادة مسموح لها → الموديول مفعّل (`@RequiresFeature`، ADR-0010) → الصلاحية. الرفض هو الافتراضي.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Optional() @Inject(AREA_AUTH) private readonly areaAuth?: AreaAuth,
    @Optional() @Inject(CLINIC_CONTEXT_RESOLVER) private readonly resolver?: ClinicContextResolver,
    @Optional() @Inject(PLATFORM_ACCOUNT_GATE) private readonly platformGate?: PlatformAccountGate,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = accessRulesOf(context.getHandler());
    if (rules.length !== 1) throw new AccessDeclarationError(rules.length);
    const rule = rules[0] as AccessRule;
    if (rule.kind === "public") return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (rule.kind === "platform_staff") return this.platformStaff(request);
    await this.clinic(request as ClinicRequest, rule, featureOf(context.getHandler()));
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
    // ADR-0020: the session must belong to an active platform-team account. Not mounted = nothing
    // can be verified, so nothing passes (the same rule as an unmounted clinic context).
    if (this.platformGate === undefined) throw new Error("access guard: platform gate not mounted");
    if (!(await this.platformGate.isActive(session.user.id))) {
      throw new ApiError("account_disabled");
    }
    (request as AuthenticatedRequest).areaSession = { area: "platform", session };
    return true;
  }

  private async clinic(
    request: ClinicRequest,
    rule: Exclude<AccessRule, { kind: "public" | "platform_staff" }>,
    feature: ClinicModule | null,
  ) {
    const areaAuth = this.auth();
    if (areaAuth.hosts.resolve(request.headers) !== "clinic") throw new ApiError("not_found");
    const session = await areaAuth.of("clinic").getSession(toHeaders(request.headers));
    if (session === null) throw new ApiError("unauthorized");
    if (this.resolver === undefined) throw new Error("access guard: clinic context not mounted");
    const { context, member } = await this.resolver.resolve(session.user.id);
    if (feature !== null && !context.enabledModules.includes(feature)) {
      throw new ApiError("module_disabled", { module: feature });
    }
    if (rule.kind === "require") {
      // Defence in depth: a key of a locked module is not granted even on a route that forgot
      // @RequiresFeature (context.permissions already drops it; this does not rely on that).
      const keyModule = MODULE_OF.get(rule.permission) ?? null;
      const usable = keyModule === null || context.enabledModules.includes(keyModule);
      const grant = usable ? grantFor(context.permissions, rule.permission) : null;
      if (grant === null) throw new ApiError("forbidden");
      request.permissionGrant = grant;
    }
    request.areaSession = { area: "clinic", session };
    request.clinicContext = context;
    request.clinicMember = member;
  }
}
