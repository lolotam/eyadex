import type { Clinic, ClinicDetail, FirstAdminInviteLink } from "@contracts/clinics";
import {
  clinicDetailsInputSchema,
  createClinicInputSchema,
  RESERVED_CLINIC_SLUGS,
  subscriptionInputSchema,
} from "@contracts/clinics";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { delay, getState, newId, persist, type MockState } from "./mock-store";
import { buildSystemRoles } from "./seed-roles";
import { INVITATION_TTL_DAYS, type InvitationRecord } from "@contracts/invitations";
import { invitationAuditSnapshot, issueInviteToken } from "./mock-invite-tokens";
import { writeClinicAudit } from "./mock-audit";
import { enforceEmailFree, toUserView, userUsage } from "./mock-user-rules";

const DAY = 24 * 60 * 60 * 1000;
const ACTOR = "Waleed Mohamed";

function findClinic(db: MockState, id: string): Clinic {
  const clinic = db.clinics.find((c) => c.id === id);
  if (!clinic) throw new ApiError("not_found");
  return clinic;
}

function usage(db: MockState, clinicId: string) {
  return {
    usersCount: userUsage(db, clinicId).used,
    branchesCount: db.branches.filter((b) => b.clinicId === clinicId && b.isActive).length,
  };
}

type Snapshot = Record<string, unknown> | null;

function audit(
  db: MockState,
  action: string,
  clinicId: string,
  summary: string,
  before: Snapshot,
  after: Snapshot,
) {
  db.platformAudit.unshift({
    id: newId(),
    actorName: ACTOR,
    action,
    clinicId,
    summary,
    before,
    after,
    createdAt: new Date().toISOString(),
  });
}

/** Allowlisted clinic fields for the platform log (names, settings, subscription). */
function clinicDetails(c: Clinic) {
  return {
    nameAr: c.nameAr,
    nameEn: c.nameEn,
    specialty: c.specialty,
    defaultLanguage: c.defaultLanguage,
    timezone: c.timezone,
  };
}
function clinicSubscription(c: Clinic) {
  return {
    status: c.status,
    expiresAt: c.expiresAt.slice(0, 10),
    maxUsers: c.maxUsers,
    maxBranches: c.maxBranches,
  };
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export function createMockPlatform(): Omit<
  ApiClient["platform"],
  "getFirstAdminInvitation" | "resendFirstAdminInvitation"
> {
  return {
    async listClinics(query) {
      await delay();
      const db = getState();
      const term = query.search.trim().toLowerCase();
      const filtered = db.clinics
        .filter((c) => !query.status || c.status === query.status)
        .filter((c) => !query.specialty || c.specialty === query.specialty)
        .filter(
          (c) => !term || [c.nameAr, c.nameEn, c.slug].some((v) => v.toLowerCase().includes(term)),
        )
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
      const detail: ClinicDetail = {
        ...clinic,
        ...usage(db, clinicId),
        features: db.features[clinicId] ?? { patients: false },
      };
      return detail;
    },

    async createClinic(raw) {
      await delay();
      if (
        typeof raw.slug === "string" &&
        (RESERVED_CLINIC_SLUGS as readonly string[]).includes(raw.slug.trim())
      ) {
        throw new ApiError("reserved_slug");
      }
      const input = createClinicInputSchema.parse(raw);
      const db = getState();
      if (db.clinics.some((c) => c.slug === input.slug)) throw new ApiError("slug_taken");
      enforceEmailFree(db, input.adminEmail);
      const now = new Date();
      const clinic: Clinic = {
        id: newId(),
        slug: input.slug,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        specialty: input.specialty,
        defaultLanguage: input.defaultLanguage,
        timezone: input.timezone,
        status: "trial",
        expiresAt: new Date(
          now.getTime() + db.platformSettings.defaultTrialDays * DAY,
        ).toISOString(),
        maxUsers: 10,
        maxBranches: 3,
        createdAt: now.toISOString(),
      };
      db.clinics.push(clinic);
      db.features[clinic.id] = { patients: true };
      const roles = buildSystemRoles(clinic.id, newId);
      let firstAdminInvite: FirstAdminInviteLink | null = null;
      db.roles.push(...roles);
      const adminRole = roles.find((r) => r.systemKey === "clinic_admin");
      if (adminRole) {
        const invitation: InvitationRecord = {
          id: newId(),
          clinicId: clinic.id,
          email: input.adminEmail.trim().toLowerCase(),
          fullName: input.adminName,
          roleId: adminRole.id,
          allBranches: true,
          branchIds: [],
          status: "pending",
          expiresAt: new Date(now.getTime() + INVITATION_TTL_DAYS * DAY).toISOString(),
          createdAt: now.toISOString(),
          invitedBy: ACTOR,
          respondedAt: null,
          tokenHash: "",
        };
        db.invitations.push(invitation);
        writeClinicAudit(db, {
          clinicId: clinic.id,
          actorName: ACTOR,
          action: "invitation.sent",
          entity: "invitation",
          before: null,
          after: invitationAuditSnapshot(invitation),
        });
        firstAdminInvite = {
          email: invitation.email,
          token: issueInviteToken(db, invitation),
          expiresAt: invitation.expiresAt,
        };
      }
      audit(
        db,
        "clinic.created",
        clinic.id,
        `Created clinic ${clinic.nameEn} with admin ${input.adminEmail}`,
        null,
        { ...clinicDetails(clinic), ...clinicSubscription(clinic), email: input.adminEmail },
      );
      persist();
      if (!firstAdminInvite) throw new ApiError("not_found");
      return { clinic, firstAdminInvite };
    },

    async updateClinicDetails(clinicId, raw) {
      await delay();
      const input = clinicDetailsInputSchema.parse(raw);
      const db = getState();
      const clinic = findClinic(db, clinicId);
      const before = clinicDetails(clinic);
      Object.assign(clinic, input);
      audit(
        db,
        "clinic.details_updated",
        clinicId,
        `Updated details of ${clinic.nameEn}`,
        before,
        clinicDetails(clinic),
      );
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
          : addMonths(
              new Date(Math.max(Date.now(), new Date(clinic.expiresAt).getTime())),
              input.durationMonths,
            );
      const before = clinicSubscription(clinic);
      clinic.status = input.status;
      clinic.maxUsers = input.maxUsers;
      clinic.maxBranches = input.maxBranches;
      clinic.expiresAt = expiresAt.toISOString();
      audit(
        db,
        "clinic.subscription_updated",
        clinicId,
        `Subscription: ${input.status}, expires ${clinic.expiresAt.slice(0, 10)}`,
        before,
        clinicSubscription(clinic),
      );
      persist();
      return clinic;
    },

    async setClinicFeature(clinicId, module, enabled) {
      await delay();
      const db = getState();
      const clinic = findClinic(db, clinicId);
      const was = Boolean((db.features[clinicId] ?? { patients: false })[module]);
      db.features[clinicId] = {
        ...(db.features[clinicId] ?? { patients: false }),
        [module]: enabled,
      };
      audit(
        db,
        "clinic.feature_toggled",
        clinicId,
        `${module} ${enabled ? "enabled" : "disabled"} for ${clinic.nameEn}`,
        { module, enabled: was },
        { module, enabled },
      );
      persist();
    },

    async listClinicMembers(clinicId) {
      await delay();
      const db = getState();
      findClinic(db, clinicId);
      return db.members.filter((m) => m.clinicId === clinicId).map((m) => toUserView(db, m));
    },

    async listClinicBranches(clinicId) {
      await delay();
      const db = getState();
      findClinic(db, clinicId);
      return db.branches.filter((b) => b.clinicId === clinicId);
    },
  };
}
