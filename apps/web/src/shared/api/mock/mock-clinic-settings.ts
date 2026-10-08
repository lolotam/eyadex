import { clinicSettingsInputSchema, type Clinic } from "@eyadex/contracts/clinics";
import { accountProfileInputSchema } from "@eyadex/contracts/users";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { authorize, clinicBlockReason, resolveActor } from "./mock-actor";
import { writeClinicAudit } from "./mock-audit";
import { delay, getState, persist } from "./mock-store";

function settingsView(c: Clinic) {
  return {
    nameAr: c.nameAr,
    nameEn: c.nameEn,
    defaultLanguage: c.defaultLanguage,
    timezone: c.timezone,
    slug: c.slug,
    specialty: c.specialty,
  };
}

/** Allowlisted audit fields for clinic settings. */
function settingsSnapshot(c: Clinic) {
  return {
    id: c.id,
    nameAr: c.nameAr,
    nameEn: c.nameEn,
    defaultLanguage: c.defaultLanguage,
    timezone: c.timezone,
  };
}

export function createMockClinicSettings(): ApiClient["clinicSettings"] {
  return {
    async get(persona) {
      await delay();
      const { clinic } = authorize(getState(), persona, "view", "clinic_settings");
      return settingsView(clinic);
    },

    async update(persona, raw) {
      await delay();
      const db = getState();
      const { clinic, actorName } = authorize(db, persona, "update", "clinic_settings");
      const parsed = clinicSettingsInputSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError("validation");
      const before = settingsSnapshot(clinic);
      Object.assign(clinic, parsed.data);
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName,
        action: "clinic.settings_updated",
        entity: "clinic",
        before,
        after: settingsSnapshot(clinic),
      });
      persist();
      return settingsView(clinic);
    },
  };
}

export function createMockAccount(): ApiClient["account"] {
  return {
    // The demo has no passwords: the account page offers the change in HTTP mode only (ADR-0020).
    changePassword: () => Promise.reject(new ApiError("not_implemented")),
    async get(persona) {
      await delay();
      const { clinic, member, role } = resolveActor(getState(), persona);
      if (clinicBlockReason(clinic)) throw new ApiError("subscription_blocked");
      return {
        fullName: member.fullName,
        email: member.email,
        preferredLanguage: member.preferredLanguage,
        roleNameAr: role.nameAr,
        roleNameEn: role.nameEn,
      };
    },

    async update(persona, raw) {
      await delay();
      const db = getState();
      const { clinic, member, role } = resolveActor(db, persona);
      if (clinicBlockReason(clinic)) throw new ApiError("subscription_blocked");
      const parsed = accountProfileInputSchema.safeParse(raw);
      if (!parsed.success) throw new ApiError("validation");
      const snap = () => ({
        id: member.id,
        fullName: member.fullName,
        preferredLanguage: member.preferredLanguage,
      });
      const before = snap();
      member.fullName = parsed.data.fullName;
      member.preferredLanguage = parsed.data.preferredLanguage;
      writeClinicAudit(db, {
        clinicId: clinic.id,
        actorName: member.fullName,
        action: "user.profile_updated",
        entity: "user",
        before,
        after: snap(),
      });
      persist();
      return {
        fullName: member.fullName,
        email: member.email,
        preferredLanguage: member.preferredLanguage,
        roleNameAr: role.nameAr,
        roleNameEn: role.nameEn,
      };
    },
  };
}
