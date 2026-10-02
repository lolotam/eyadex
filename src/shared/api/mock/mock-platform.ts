import type { Clinic, ClinicDetail } from "@contracts/clinics";
import { clinicDetailsInputSchema, createClinicInputSchema, RESERVED_CLINIC_SLUGS, subscriptionInputSchema } from "@contracts/clinics";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { delay, getState, newId, persist, type MockState } from "./mock-store";
import { buildSystemRoles } from "./seed-roles";

const DAY = 24 * 60 * 60 * 1000;
const ACTOR = "Waleed Mohamed";

function findClinic(db: MockState, id: string): Clinic {
  const clinic = db.clinics.find((c) => c.id === id);
  if (!clinic) throw new ApiError("not_found");
  return clinic;
}

function usage(db: MockState, clinicId: string) {
  return {
    usersCount: db.members.filter((m) => m.clinicId === clinicId && m.status !== "deactivated").length,
    branchesCount: db.branches.filter((b) => b.clinicId === clinicId && b.isActive).length,
  };
}

function audit(db: MockState, action: string, clinicId: string, summary: string) {
  db.platformAudit.unshift({ id: newId(), actorName: ACTOR, action, clinicId, summary, createdAt: new Date().toISOString() });
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export function createMockPlatform(): ApiClient["platform"] {
  return {
    async listClinics(query) {
      await delay();
      const db = getState();
      const term = query.search.trim().toLowerCase();
      const filtered = db.clinics
        .filter((c) => !query.status || c.status === query.status)
        .filter((c) => !query.specialty || c.specialty === query.specialty)
        .filter((c) => !term || [c.nameAr, c.nameEn, c.slug].some((v) => v.toLowerCase().includes(term)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const start = query.cursor ? filtered.findIndex((c) => c.id === query.cursor) + 1 : 0;
      const slice = filtered.slice(start, start + query.limit);
      const last = slice[slice.length - 1];
      const hasMore = start + query.limit < filtered.length;
      return {
        items: slice.map((c) => ({ ...c, ...usage(db, c.id) })),
        nextCursor: hasMore && last ? last.id : null,
        total: filtered.length,
      };
    },

    async getClinic(clinicId) {
      await delay();
      const db = getState();
      const clinic = findClinic(db, clinicId);
      const detail: ClinicDetail = { ...clinic, ...usage(db, clinicId), features: db.features[clinicId] ?? { patients: false } };
      return detail;
    },

    async createClinic(raw) {
      await delay();
      if (typeof raw.slug === "string" && (RESERVED_CLINIC_SLUGS as readonly string[]).includes(raw.slug.trim())) {
        throw new ApiError("reserved_slug");
      }
      const input = createClinicInputSchema.parse(raw);
      const db = getState();
      if (db.clinics.some((c) => c.slug === input.slug)) throw new ApiError("slug_taken");
      const now = new Date();
      const clinic: Clinic = {
        id: newId(), slug: input.slug, nameAr: input.nameAr, nameEn: input.nameEn, specialty: input.specialty,
        defaultLanguage: input.defaultLanguage, timezone: input.timezone, status: "trial",
        expiresAt: new Date(now.getTime() + 30 * DAY).toISOString(), maxUsers: 10, maxBranches: 3, createdAt: now.toISOString(),
      };
      db.clinics.push(clinic);
      db.features[clinic.id] = { patients: true };
      const roles = buildSystemRoles(clinic.id, newId);
      db.roles.push(...roles);
      const adminRole = roles.find((r) => r.systemKey === "clinic_admin");
      if (adminRole) {
        const memberId = newId();
        db.members.push({
          id: memberId, clinicId: clinic.id, userId: newId(), fullName: input.adminName, email: input.adminEmail,
          roleId: adminRole.id, allBranches: true, branchIds: [], status: "invited",
          preferredLanguage: input.defaultLanguage, createdAt: now.toISOString(),
        });
        db.invitations.push({ id: newId(), clinicId: clinic.id, memberId, email: input.adminEmail, status: "pending", sentAt: now.toISOString() });
      }
      audit(db, "clinic.created", clinic.id, `Created clinic ${clinic.nameEn} with admin ${input.adminEmail}`);
      persist();
      return clinic;
    },

    async updateClinicDetails(clinicId, raw) {
      await delay();
      const input = clinicDetailsInputSchema.parse(raw);
      const db = getState();
      const clinic = findClinic(db, clinicId);
      Object.assign(clinic, input);
      audit(db, "clinic.details_updated", clinicId, `Updated details of ${clinic.nameEn}`);
      persist();
      return clinic;
    },

    async updateSubscription(clinicId, raw) {
      await delay();
      const input = subscriptionInputSchema.parse(raw);
      const db = getState();
      const clinic = findClinic(db, clinicId);
      const current = usage(db, clinicId);
      if (input.maxUsers < current.usersCount || input.maxBranches < current.branchesCount) {
        throw new ApiError("limit_below_usage");
      }
      const expiresAt =
        input.expiryMode === "date"
          ? new Date(`${input.expiresOn}T23:59:59Z`)
          : addMonths(new Date(Math.max(Date.now(), new Date(clinic.expiresAt).getTime())), input.durationMonths);
      clinic.status = input.status;
      clinic.maxUsers = input.maxUsers;
      clinic.maxBranches = input.maxBranches;
      clinic.expiresAt = expiresAt.toISOString();
      audit(db, "clinic.subscription_updated", clinicId, `Subscription: ${input.status}, expires ${clinic.expiresAt.slice(0, 10)}`);
      persist();
      return clinic;
    },

    async setClinicFeature(clinicId, module, enabled) {
      await delay();
      const db = getState();
      const clinic = findClinic(db, clinicId);
      db.features[clinicId] = { ...(db.features[clinicId] ?? { patients: false }), [module]: enabled };
      audit(db, "clinic.feature_toggled", clinicId, `${module} ${enabled ? "enabled" : "disabled"} for ${clinic.nameEn}`);
      persist();
    },

    async listClinicMembers(clinicId) {
      await delay();
      const db = getState();
      findClinic(db, clinicId);
      return db.members
        .filter((m) => m.clinicId === clinicId)
        .map((m) => {
          const role = db.roles.find((r) => r.id === m.roleId);
          return { ...m, roleNameAr: role?.nameAr ?? "", roleNameEn: role?.nameEn ?? "" };
        });
    },

    async listClinicBranches(clinicId) {
      await delay();
      const db = getState();
      findClinic(db, clinicId);
      return db.branches.filter((b) => b.clinicId === clinicId);
    },
  };
}
