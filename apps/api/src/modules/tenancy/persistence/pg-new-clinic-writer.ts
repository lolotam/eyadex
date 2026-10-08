import type { Tx } from "@eyadex/db";
import type { CreateClinicRequest } from "@eyadex/contracts/onboarding";
import { sql } from "drizzle-orm";

/**
 * بيكتب صف العيادة ومفاتيح موديولاتها جوه transaction الـ onboarding (0001، 0002). الـ slug المكرر
 * بيطلع `DatabaseError` بالقيد `clinics_slug_key`.
 *
 * @param tx transaction العيادة الجديدة
 * @param clinicId الـ id اللي `withNewTenant` ولّده
 * @param input الطلب بعد الـ contract
 * @param featureId id صف `clinic_features`
 * @param now الوقت
 * @returns بيخلص لما الصفوف تتكتب
 */
export async function insertNewClinic(
  tx: Tx,
  clinicId: string,
  input: Omit<CreateClinicRequest, "expiresAt" | "trialDays"> & { readonly expiresAt: Date },
  featureId: string,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  await tx.execute(
    sql`INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language, timezone,
          status, expires_at, max_users, max_branches, created_at, updated_at)
        VALUES (${clinicId}, ${input.slug}, ${input.nameAr}, ${input.nameEn}, ${input.specialty},
          ${input.defaultLanguage}, ${input.timezone}, ${input.status},
          ${input.expiresAt.toISOString()}::timestamptz, ${input.maxUsers},
          ${input.maxBranches}, ${at}::timestamptz, ${at}::timestamptz)`,
  );
  await tx.execute(
    sql`INSERT INTO clinic_features (clinic_id, id, module, enabled, updated_at)
        VALUES (${clinicId}, ${featureId}, 'patients', ${input.modules.patients}, ${at}::timestamptz)`,
  );
}
