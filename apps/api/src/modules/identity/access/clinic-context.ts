import { ApiError } from "../../../shared/errors.ts";
import type { Clock } from "../../tenancy/index.ts";
import {
  decideMemberAccess,
  effectivePermissions,
  type MemberAccess,
} from "../domain/member-access.ts";
import type { MemberAccessReader } from "../ports/member-access-reader.ts";
import type { AuthorizationCache } from "./authorization-cache.ts";

/** الفروع اللي استعلامات النطاق `branch` بتفلتر بيها. */
export type BranchScope =
  { readonly all: true } | { readonly all: false; readonly branchIds: readonly string[] };

/** اللي use cases والـ queries بتستلمه (ADR-0009). كل شغل الداتابيز لسه جوه `withTenant(clinicId)`. */
export interface ClinicRequestContext {
  readonly userId: string;
  readonly clinicId: string;
  readonly membershipId: string;
  readonly roleId: string;
  readonly permissions: readonly string[];
  readonly branchScope: BranchScope;
}

/** السياق والعضو كامل (لـ `/me`). */
export interface ResolvedMember {
  readonly context: ClinicRequestContext;
  readonly member: MemberAccess;
}

/** Token الـ DI. */
export const CLINIC_CONTEXT_RESOLVER = Symbol("identity.ClinicContextResolver");

export interface ClinicContextDeps {
  readonly reader: MemberAccessReader;
  readonly cache: AuthorizationCache;
  readonly clock: Clock;
  readonly logger: { warn(fields: object, message: string): void };
}

/**
 * الخطوتين 1–2 من PRD §4.7 لمستخدم جلسته اتحققت: عضوية نشطة، والعيادة مسموح لها دلوقتي.
 * Redis واقع → الداتابيز، عمره ما بيوصل لـ "مسموح" من غير قراءة (ADR-0009).
 */
export class ClinicContextResolver {
  constructor(private readonly deps: ClinicContextDeps) {}

  async resolve(userId: string): Promise<ResolvedMember> {
    const member = await this.load(userId);
    if (member === null) throw new ApiError("forbidden");
    const decision = decideMemberAccess(member, this.deps.clock.now());
    if (!decision.allowed) {
      throw decision.code === "subscription_blocked"
        ? new ApiError("subscription_blocked", { reason: decision.reason })
        : new ApiError("account_disabled");
    }
    return {
      member,
      context: {
        userId,
        clinicId: member.clinicId,
        membershipId: member.membershipId,
        roleId: member.role.id,
        permissions: effectivePermissions(member),
        branchScope: member.allBranches
          ? { all: true }
          : { all: false, branchIds: member.branchIds },
      },
    };
  }

  private async load(userId: string): Promise<MemberAccess | null> {
    const { reader, cache } = this.deps;
    const clinicId = (await this.cached(() => cache.clinicOf(userId))) ?? null;
    const resolved = clinicId ?? (await reader.clinicForUser(userId));
    if (resolved === null) return null;
    if (clinicId === null) await this.cached(() => cache.rememberClinic(userId, resolved));
    const version = await this.cached(() => cache.version(resolved));
    if (version === undefined) return reader.readMember(resolved, userId);
    const hit = await this.cached(() => cache.member(resolved, version, userId));
    if (hit) return hit;
    const fresh = await reader.readMember(resolved, userId);
    if (fresh !== null) await this.cached(() => cache.store(resolved, version, fresh));
    return fresh;
  }

  // A cache failure is never an answer: `undefined` sends the caller to the database.
  private async cached<T>(op: () => Promise<T>): Promise<T | undefined> {
    try {
      return await op();
    } catch (error) {
      this.deps.logger.warn({ err: error }, "authorization cache unavailable");
      return undefined;
    }
  }
}
