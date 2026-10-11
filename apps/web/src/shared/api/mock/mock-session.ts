import type { ApiClient } from "../api-client";
import { NO_FEATURES } from "@eyadex/contracts/clinics";
import { ApiError } from "../api-error";
import {
  clinicBlockReason,
  effectivePermissions,
  memberBranchScope,
  resolveActor,
} from "./mock-actor";
import { delay, getState, persist } from "./mock-store";
import {
  platformAccountSnapshot,
  resolvePlatformActor,
  writePlatformAudit,
} from "./mock-platform-actor";
import { expiryAlertDays } from "@eyadex/contracts/platform";

const LOGIN_REFRESH_MS = 5 * 60 * 1000;

export function createMockSession(): ApiClient["session"] {
  return {
    async listLoginClinics() {
      await delay(80);
      return getState().clinics.map((c) => ({ id: c.id, nameAr: c.nameAr, nameEn: c.nameEn }));
    },

    async listLoginAccounts(clinicId) {
      await delay(80);
      const db = getState();
      return db.members
        .filter((m) => m.clinicId === clinicId)
        .map((m) => ({
          memberId: m.id,
          fullName: m.fullName,
          roleKey: db.roles.find((r) => r.id === m.roleId)?.systemKey ?? null,
          roleNameAr: db.roles.find((r) => r.id === m.roleId)?.nameAr ?? "",
          roleNameEn: db.roles.find((r) => r.id === m.roleId)?.nameEn ?? "",
          status: m.status,
        }));
    },

    async listLoginPlatformAccounts() {
      await delay(80);
      return [...getState().platformAccounts]
        .sort((x, y) => x.createdAt.localeCompare(y.createdAt))
        .map((a) => ({ memberId: a.id, fullName: a.fullName, status: a.status }));
    },

    async acceptPlatformInvitation(memberId) {
      await delay(80);
      const db = getState();
      const account = db.platformAccounts.find((a) => a.id === memberId);
      if (!account) throw new ApiError("not_found");
      // Only a pending invitation can be accepted; a deactivated account stays out.
      if (account.status !== "invited") throw new ApiError("invitation_used");
      const before = platformAccountSnapshot(account);
      account.status = "active";
      account.joinedAt = new Date().toISOString();
      writePlatformAudit(db, {
        actorName: account.fullName,
        action: "platform_account.joined",
        clinicId: null,
        entityId: account.id,
        summary: `${account.email} joined the platform team`,
        before,
        after: platformAccountSnapshot(account),
      });
      persist();
      return { memberId: account.id, fullName: account.fullName, status: account.status };
    },

    async getContext(persona) {
      await delay(80);
      const db = getState();
      if (persona.kind === "platform_admin") {
        const account = resolvePlatformActor(db, persona);
        return {
          persona,
          user: { fullName: account.fullName, email: account.email, preferredLanguage: null },
          clinic: null,
          permissions: [],
          membershipId: null,
          allBranches: false,
          branchIds: [],
          features: { ...NO_FEATURES },
          blocked: null,
          expiresInDays: null,
        };
      }
      const actor = resolveActor(db, persona);
      const { clinic, member } = actor;
      if (!clinic) throw new ApiError("not_found");
      const last = member.lastLoginAt ? new Date(member.lastLoginAt).getTime() : 0;
      if (Date.now() - last > LOGIN_REFRESH_MS) {
        member.lastLoginAt = new Date().toISOString();
        persist();
      }
      const blocked = clinicBlockReason(clinic);
      return {
        persona,
        user: {
          fullName: member.fullName,
          email: member.email,
          preferredLanguage: member.preferredLanguage,
        },
        clinic: {
          id: clinic.id,
          nameAr: clinic.nameAr,
          nameEn: clinic.nameEn,
          status: clinic.status,
          expiresAt: clinic.expiresAt,
          timezone: clinic.timezone,
        },
        permissions: blocked ? [] : effectivePermissions(db, actor),
        membershipId: member.id,
        ...memberBranchScope(db, member),
        features: db.features[clinic.id] ?? NO_FEATURES,
        blocked,
        expiresInDays: blocked
          ? null
          : expiryAlertDays(clinic.expiresAt, db.platformSettings.alertDaysBeforeExpiry),
      };
    },
  };
}
