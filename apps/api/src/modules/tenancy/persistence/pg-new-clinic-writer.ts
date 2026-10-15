import { moduleSchema } from "@eyadex/contracts/clinics";
import { SUPPORTED_CURRENCIES } from "@eyadex/contracts/money";
import type { CreateClinicRequest } from "@eyadex/contracts/onboarding";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

/**
 * بيكتب صف العيادة وصف لكل موديول (0001، 0002، 0042) جوه transaction الـ onboarding. الـ slug المكرر
 * بيطلع `DatabaseError` بالقيد `clinics_slug_key`. موديول جديد في `moduleSchema` بياخد صفه من غير تعديل هنا.
 *
 * @param tx transaction العيادة الجديدة
 * @param clinicId الـ id اللي `withNewTenant` ولّده
 * @param input الطلب بعد الـ contract
 * @param newId مولّد ids صفوف `clinic_features` (UUID v7)
 * @param now الوقت
 * @returns بيخلص لما الصفوف تتكتب
 */
export async function insertNewClinic(
  tx: Tx,
  clinicId: string,
  input: Omit<CreateClinicRequest, "expiresAt" | "trialDays"> & { readonly expiresAt: Date },
  newId: () => string,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  // Finance F1 (spec §8 rule 6): the exponent follows the currency, never typed; KWD and 0 % by default.
  const currency = input.currency ?? "KWD";
  await tx.execute(
    sql`INSERT INTO clinics (id, slug, name_ar, name_en, specialty, default_language, timezone,
          status, expires_at, max_users, max_branches, currency, currency_exponent, tax_rate_bp,
          created_at, updated_at)
        VALUES (${clinicId}, ${input.slug}, ${input.nameAr}, ${input.nameEn}, ${input.specialty},
          ${input.defaultLanguage}, ${input.timezone}, ${input.status},
          ${input.expiresAt.toISOString()}::timestamptz, ${input.maxUsers},
          ${input.maxBranches}, ${currency}, ${SUPPORTED_CURRENCIES[currency]},
          ${input.taxRateBp ?? 0}, ${at}::timestamptz, ${at}::timestamptz)`,
  );
  for (const module of moduleSchema.options) {
    await tx.execute(
      sql`INSERT INTO clinic_features (clinic_id, id, module, enabled, updated_at)
          VALUES (${clinicId}, ${newId()}, ${module}, ${input.modules[module]}, ${at}::timestamptz)`,
    );
  }
}
