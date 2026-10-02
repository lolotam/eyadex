import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { PERMISSION_CATALOG } from "@contracts/permissions";
import { delay, getState } from "./mock-store";

export function createMockSession(): ApiClient["session"] {
  return {
    async listLoginClinics() {
      await delay(80);
      return getState().clinics.map((c) => ({ id: c.id, nameAr: c.nameAr, nameEn: c.nameEn }));
    },

    async getContext(persona) {
      await delay(80);
      const db = getState();
      if (persona.kind === "platform_admin") {
        return {
          persona,
          user: { fullName: "Waleed Mohamed", email: "waleed@eyadex.com" },
          clinic: null,
          permissions: [],
          features: { patients: false },
          blocked: null,
        };
      }
      const clinic = db.clinics.find((c) => c.id === persona.clinicId);
      if (!clinic) throw new ApiError("not_found");
      const role = db.roles.find((r) => r.clinicId === clinic.id && r.systemKey === persona.kind);
      const member = db.members.find(
        (m) => m.clinicId === clinic.id && m.roleId === role?.id && m.status === "active",
      );
      if (!role || !member) throw new ApiError("not_found");
      const features = db.features[clinic.id] ?? { patients: false };
      const permissions = role.permissions.filter((key) => {
        const def = PERMISSION_CATALOG.find((p) => p.key === key);
        return def && (def.module === null || features[def.module]);
      });
      const blocked =
        clinic.status === "suspended"
          ? "suspended"
          : new Date(clinic.expiresAt).getTime() < Date.now()
            ? "expired"
            : null;
      return {
        persona,
        user: { fullName: member.fullName, email: member.email },
        clinic: {
          id: clinic.id,
          nameAr: clinic.nameAr,
          nameEn: clinic.nameEn,
          status: clinic.status,
          expiresAt: clinic.expiresAt,
        },
        permissions: blocked ? [] : permissions,
        features,
        blocked,
      };
    },
  };
}
