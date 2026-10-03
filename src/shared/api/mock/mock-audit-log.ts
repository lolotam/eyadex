import {
  clinicAuditListQuerySchema,
  dayInTimeZone,
  PLATFORM_AUDIT_TIME_ZONE,
  platformAuditListQuerySchema,
  type PlatformAuditItem,
} from "@contracts/audit";
import type { Page } from "@contracts/common";
import type { ApiClient } from "../api-client";
import { ApiError } from "../api-error";
import { authorize } from "./mock-actor";
import { delay, getState } from "./mock-store";

type Dated = { id: string; at: string; actorName: string; action: string };
type CommonFilters = {
  actor: string;
  action: string | null;
  from: string | null;
  to: string | null;
};

function matches(item: Dated, f: CommonFilters, timeZone: string): boolean {
  if (f.actor && !item.actorName.toLocaleLowerCase().includes(f.actor.toLocaleLowerCase()))
    return false;
  if (f.action && item.action !== f.action) return false;
  if (f.from || f.to) {
    const day = dayInTimeZone(item.at, timeZone);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
  }
  return true;
}

/** Newest first with id as tie-breaker, so a cursor always lands on the same next row. */
function paginate<T extends Dated>(items: T[], cursor: string | null, limit: number): Page<T> {
  const sorted = [...items].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const start = cursor ? sorted.findIndex((i) => i.id === cursor) + 1 : 0;
  if (cursor && start === 0) throw new ApiError("validation");
  const page = sorted.slice(start, start + limit);
  const last = page.at(-1);
  return {
    items: page,
    total: sorted.length,
    nextCursor: start + limit < sorted.length && last ? last.id : null,
  };
}

export function createMockAuditLog(): ApiClient["audit"] {
  return {
    async clinicList(persona, rawQuery) {
      await delay();
      const db = getState();
      const { clinic } = authorize(db, persona, "view", "audit_log");
      const parsed = clinicAuditListQuerySchema.safeParse(rawQuery);
      if (!parsed.success) throw new ApiError("validation");
      const q = parsed.data;
      const items = db.clinicAudit
        .filter((e) => e.clinicId === clinic.id)
        .map((e) => ({
          id: e.id,
          at: e.createdAt,
          actorName: e.actorName,
          action: e.action,
          entity: e.entity,
          category: e.category,
          entityId: e.entityId,
          before: e.before,
          after: e.after,
        }))
        .filter((e) => !q.entity || e.entity === q.entity)
        .filter((e) => !q.category || e.category === q.category)
        .filter((e) => matches(e, q, clinic.timezone));
      return paginate(items, q.cursor, q.limit);
    },

    async platformList(persona, rawQuery) {
      await delay();
      if (persona.kind !== "platform_admin") throw new ApiError("forbidden");
      const parsed = platformAuditListQuerySchema.safeParse(rawQuery);
      if (!parsed.success) throw new ApiError("validation");
      const q = parsed.data;
      const db = getState();
      const clinicName = (id: string | null) => db.clinics.find((c) => c.id === id) ?? null;

      const platform: PlatformAuditItem[] = db.platformAudit.map((e) => {
        const c = clinicName(e.clinicId);
        return {
          id: e.id,
          at: e.createdAt,
          actorName: e.actorName,
          action: e.action,
          source: "platform",
          entity: e.action.startsWith("invitation.") ? "invitation" : "clinic",
          category: "administrative",
          entityId: e.clinicId,
          clinicId: e.clinicId,
          clinicNameAr: c?.nameAr ?? null,
          clinicNameEn: c?.nameEn ?? null,
          before: e.before,
          after: e.after,
        };
      });
      // Filtered at the source: patient entities and patient-access entries never leave here.
      const clinicSide: PlatformAuditItem[] = [];
      for (const e of db.clinicAudit) {
        if (e.category !== "administrative" || e.entity === "patient") continue;
        const c = clinicName(e.clinicId);
        clinicSide.push({
          id: e.id,
          at: e.createdAt,
          actorName: e.actorName,
          action: e.action,
          source: "clinic",
          entity: e.entity,
          category: "administrative",
          entityId: e.entityId,
          clinicId: e.clinicId,
          clinicNameAr: c?.nameAr ?? null,
          clinicNameEn: c?.nameEn ?? null,
          before: e.before,
          after: e.after,
        });
      }
      const items = [...platform, ...clinicSide]
        .filter((e) => !q.entity || e.entity === q.entity)
        .filter((e) => !q.source || e.source === q.source)
        .filter((e) => !q.clinicId || e.clinicId === q.clinicId)
        .filter((e) => matches(e, q, PLATFORM_AUDIT_TIME_ZONE));
      return paginate(items, q.cursor, q.limit);
    },

    async platformClinicOptions(persona) {
      await delay();
      if (persona.kind !== "platform_admin") throw new ApiError("forbidden");
      return getState()
        .clinics.map((c) => ({ id: c.id, nameAr: c.nameAr, nameEn: c.nameEn }))
        .sort((x, y) => x.nameEn.localeCompare(y.nameEn));
    },
  };
}
