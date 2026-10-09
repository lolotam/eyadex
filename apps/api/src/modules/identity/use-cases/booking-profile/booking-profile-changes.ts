import type { BookingProfile, BookingProfileInput } from "@eyadex/contracts/services";
import type { Database } from "@eyadex/db";
import type { IdGenerator } from "@eyadex/ids";
import { scrubAuditText } from "@eyadex/observability";

import { writeClinicAudit } from "../../../../shared/clinic-audit.ts";
import { ApiError } from "../../../../shared/errors.ts";
import { lockProvider } from "../../../../shared/provider-lock.ts";
import type { Clock } from "../../../tenancy/index.ts";
import {
  readBookingProfile,
  saveBookingProfile,
} from "../../persistence/pg-booking-profile-store.ts";
import { lockClinicRoles } from "../../persistence/pg-role-store.ts";
import { findMemberForUpdate, lockClinicUsers } from "../../persistence/pg-user-store.ts";
import { findUserView } from "../../queries/user-views.ts";
import { assertActorMay } from "../role-changes/grant-bound.ts";
import { assertMayTouchAdmin, type UserActor } from "../user-changes/user-changes.ts";

export interface BookingProfileDeps {
  readonly db: Database;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * إعدادات الحجز لعضو (D-1، D-15، ADR-0026 §5): بيستقبل مواعيد ولا لأ، ومدته الافتراضية. التغيير transaction
 * واحدة تحت أقفال الأدوار ثم المستخدمين (نفس ترتيب ADR-0012) ثم قفل مقدّم الخدمة (D-13)، فيها صف سجل واحد.
 * القرار من الصلاحيات بس، عمره ما بيبص على اسم الدور.
 */
export class BookingProfileChanges {
  constructor(private readonly deps: BookingProfileDeps) {}

  /**
   * إعدادات عضو.
   *
   * @param actor الفاعل
   * @param memberId العضوية
   * @returns الإعدادات؛ عضو مش في العيادة دي → `not_found`
   */
  read(actor: UserActor, memberId: string): Promise<BookingProfile> {
    return this.deps.db.withTenant(actor.clinicId, async (tx) => {
      const profile = await readBookingProfile(tx, actor.clinicId, memberId);
      if (profile === null) throw new ApiError("not_found");
      return profile;
    });
  }

  /**
   * يغيّر الإعدادات؛ نفس القيم = نفس الرد من غير صف سجل.
   *
   * @param actor الفاعل
   * @param memberId العضوية
   * @param input القيم بعد `bookingProfileInputSchema`
   * @returns الإعدادات بعد التغيير
   */
  update(actor: UserActor, memberId: string, input: BookingProfileInput): Promise<BookingProfile> {
    const { db, clock, ids } = this.deps;
    const { clinicId } = actor;
    return db.withTenant(clinicId, async (tx) => {
      await lockClinicRoles(tx, clinicId);
      await lockClinicUsers(tx, clinicId);
      // The route's own key, on the actor as it is after the locks (`@Require` ran before them).
      await assertActorMay(tx, actor, "update:users:clinic");
      const member = await findMemberForUpdate(tx, clinicId, memberId);
      if (member === null) throw new ApiError("not_found");
      await assertMayTouchAdmin(tx, actor, [member.roleSystemKey]);
      await lockProvider(tx, clinicId, memberId);
      const before = await readBookingProfile(tx, clinicId, memberId);
      if (before === null) throw new ApiError("not_found");
      const same =
        before.acceptsAppointments === input.acceptsAppointments &&
        before.defaultDurationMinutes === input.defaultDurationMinutes;
      if (same) return before;
      const now = clock.now();
      await saveBookingProfile(tx, clinicId, memberId, input, now);
      const fullName = scrubAuditText((await findUserView(tx, clinicId, memberId))?.fullName ?? "");
      await writeClinicAudit(tx, {
        clinicId,
        id: ids.newId(),
        actorUserId: actor.userId,
        action: "user.booking_changed",
        entityType: "user",
        entityId: memberId,
        details: {
          before: {
            fullName,
            acceptsAppointments: before.acceptsAppointments,
            defaultDurationMinutes: before.defaultDurationMinutes,
          },
          after: { fullName, ...input },
        },
        createdAt: now,
      });
      return { memberId, ...input };
    });
  }
}
