import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { clinicBlockReason, effectivePermissions, resolveActor } from "./mock-actor";
import { delay, getState, persist } from "./mock-store";
import { resolvePlatformActor } from "./mock-platform-actor";
import { expiryAlertDays } from "@contracts/platform";

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

    async getContext(persona) {
      await delay(80);
      const db = getState();
      if (persona.kind === "platform_admin") {
        const account = resolvePlatformActor(db, persona);
        return {
          persona,
          user: { fullName: account.fullName, email: account.email },
          clinic: null,
          permissions: [],
          features: { patients: false },
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
        user: { fullName: member.fullName, email: member.email },
        clinic: {
          id: clinic.id,
          nameAr: clinic.nameAr,
          nameEn: clinic.nameEn,
          status: clinic.status,
          expiresAt: clinic.expiresAt,
          timezone: clinic.timezone,
        },
        permissions: blocked ? [] : effectivePermissions(db, actor),
        features: db.features[clinic.id] ?? { patients: false },
        blocked,
        expiresInDays: blocked
          ? null
          : expiryAlertDays(clinic.expiresAt, db.platformSettings.alertDaysBeforeExpiry),
      };
    },
  };
}
