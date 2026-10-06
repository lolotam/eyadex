import type { Redis } from "ioredis";

import type { MemberAccess } from "../domain/member-access.ts";
import type { AuthorizationInvalidator } from "../ports/authorization-invalidator.ts";

/** Seconds a member entry lives: the safety net when an invalidation was missed (ADR-0009). */
export const MEMBER_TTL_SECONDS = 30;
/** A membership never moves clinic (0027: one account, one membership; never deleted). */
export const USER_CLINIC_TTL_SECONDS = 3_600;

const PREFIX = "eyadex:authz";
const versionKey = (clinicId: string) => `${PREFIX}:ver:${clinicId}`;
const userClinicKey = (userId: string) => `${PREFIX}:uc:${userId}`;
const memberKey = (clinicId: string, version: string, userId: string) =>
  `${PREFIX}:m:${clinicId}:${version}:${userId}`;

/**
 * Versioned cache (ADR-0009). The version is read BEFORE the database, so a change committed while
 * a request reads the old rows bumps the version first and the stale entry lands under a key no
 * request reads again. Every method throws when Redis fails; the caller then reads the database.
 */
export class AuthorizationCache implements AuthorizationInvalidator {
  constructor(private readonly redis: Redis) {}

  async clinicOf(userId: string): Promise<string | null> {
    return this.redis.get(userClinicKey(userId));
  }

  async rememberClinic(userId: string, clinicId: string): Promise<void> {
    await this.redis.set(userClinicKey(userId), clinicId, "EX", USER_CLINIC_TTL_SECONDS);
  }

  async version(clinicId: string): Promise<string> {
    return (await this.redis.get(versionKey(clinicId))) ?? "0";
  }

  async member(clinicId: string, version: string, userId: string): Promise<MemberAccess | null> {
    const raw = await this.redis.get(memberKey(clinicId, version, userId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as MemberAccess;
    // An entry is only trusted for the exact clinic and user it was stored for.
    return parsed.clinicId === clinicId && parsed.userId === userId ? parsed : null;
  }

  async store(clinicId: string, version: string, member: MemberAccess): Promise<void> {
    await this.redis.set(
      memberKey(clinicId, version, member.userId),
      JSON.stringify(member),
      "EX",
      MEMBER_TTL_SECONDS,
    );
  }

  async clinicChanged(clinicId: string): Promise<void> {
    await this.redis.incr(versionKey(clinicId));
  }
}
