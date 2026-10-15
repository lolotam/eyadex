import { sql, type Tx } from "@eyadex/db";

import type {
  AppointmentSubject,
  InvoiceSubject,
  VisitSubject,
} from "../ports/notification-store.ts";

type AppointmentRow = {
  status: AppointmentSubject["status"];
  starts_at: string;
  same_start: boolean;
  created_by: string;
  branch_name_ar: string;
  branch_name_en: string;
  branch_address: string | null;
  provider_name: string;
};

/**
 * الموعد `FOR SHARE` (الفرع ومقدم الخدمة قراءة عادية): الحالة، هل البداية لسه هي `subject_at`، والفرع
 * واسم مقدم الخدمة. مفيش خدمة ولا ملاحظة في الـ SELECT أصلاً (N-4).
 *
 * @returns الموعد ومستخدم اللي حجزه (فاعل سطر التحويل للتذكير)، أو `null` لو مش موجود
 */
export async function readAppointment(
  tx: Tx,
  clinicId: string,
  appointmentId: string,
  subjectAt: string,
): Promise<(AppointmentSubject & { readonly createdByUserId: string | null }) | null> {
  const [row] = (await tx.execute(
    sql`SELECT a.status, to_json(a.starts_at) #>> '{}' AS starts_at,
               a.starts_at = ${subjectAt}::timestamptz AS same_start, a.created_by,
               b.name_ar AS branch_name_ar, b.name_en AS branch_name_en, b.address AS branch_address,
               p.full_name AS provider_name
        FROM appointments a
        JOIN branches b ON b.clinic_id = a.clinic_id AND b.id = a.branch_id
        JOIN memberships p ON p.clinic_id = a.clinic_id AND p.id = a.provider_membership_id
        WHERE a.clinic_id = ${clinicId} AND a.id = ${appointmentId}
        FOR SHARE OF a`,
  )) as unknown as AppointmentRow[];
  if (row === undefined) return null;
  return {
    status: row.status,
    startUnchanged: row.same_start,
    startsAt: new Date(row.starts_at),
    branch: { nameAr: row.branch_name_ar, nameEn: row.branch_name_en, address: row.branch_address },
    providerName: row.provider_name,
    // created_by is the booking actor's user id, not their membership id.
    createdByUserId: row.created_by,
  };
}

type VisitRow = {
  status: "draft" | "signed" | "cancelled";
  branch_id: string;
  doctor_name: string | null;
  signer_user_id: string | null;
};

type LineRow = {
  id: string;
  medicine_enc: string;
  dose_enc: string;
  frequency_enc: string;
  duration_enc: string;
  note_enc: string | null;
};

/**
 * الزيارة `FOR SHARE` واللي وقّعها وسطور الوصفة النشطة بالترتيب (ظروف لسه مقفولة). الملحق عمره ما
 * بيعيد الإرسال، فالزيارة الموقّعة مابتتغيّرش بعد كده.
 *
 * @returns الزيارة، أو `null` لو مش موجودة أو مش موقّعة
 */
export async function readVisit(
  tx: Tx,
  clinicId: string,
  visitId: string,
): Promise<VisitSubject | null> {
  const [visit] = (await tx.execute(
    sql`SELECT v.status, v.branch_id, m.full_name AS doctor_name, m.user_id AS signer_user_id
        FROM visits v
        LEFT JOIN memberships m ON m.clinic_id = v.clinic_id AND m.id = v.signed_by
        WHERE v.clinic_id = ${clinicId} AND v.id = ${visitId}
        FOR SHARE OF v`,
  )) as unknown as VisitRow[];
  if (
    visit === undefined ||
    visit.status !== "signed" ||
    visit.doctor_name === null ||
    visit.signer_user_id === null
  ) {
    return null;
  }
  const lines = (await tx.execute(
    sql`SELECT id, medicine_enc, dose_enc, frequency_enc, duration_enc, note_enc
        FROM visit_prescription_items
        WHERE clinic_id = ${clinicId} AND visit_id = ${visitId} AND archived_at IS NULL
        ORDER BY position`,
  )) as unknown as LineRow[];
  return {
    visitId,
    branchId: visit.branch_id,
    doctorName: visit.doctor_name,
    signerUserId: visit.signer_user_id,
    lines: lines.map((l) => ({
      id: l.id,
      medicine: l.medicine_enc,
      dose: l.dose_enc,
      frequency: l.frequency_enc,
      duration: l.duration_enc,
      note: l.note_enc,
    })),
  };
}

/**
 * مستخدم العضوية (فاعل سطر السجل).
 *
 * @returns `user_id`، أو `null` لو العضوية مش موجودة
 */
export async function userOfMembership(
  tx: Tx,
  clinicId: string,
  membershipId: string,
): Promise<string | null> {
  const [row] = (await tx.execute(
    sql`SELECT user_id FROM memberships WHERE clinic_id = ${clinicId} AND id = ${membershipId}`,
  )) as unknown as { user_id: string }[];
  return row?.user_id ?? null;
}

/**
 * الفاتورة `FOR SHARE` (spec §8 rule 15): إلغاء جاري بيخلص الأول، وتعديل بعد كده بيستنى الإرسال. الرقم
 * والإجمالي والعملة والحالة بس؛ مفيش سطور ولا مراجع في الـ SELECT.
 *
 * @returns الفاتورة، أو `null` لو مش موجودة
 */
export async function readInvoice(
  tx: Tx,
  clinicId: string,
  invoiceId: string,
): Promise<InvoiceSubject | null> {
  const [row] = (await tx.execute(
    sql`SELECT number, total_minor::text AS total_minor, currency, currency_exponent, status FROM invoices
        WHERE clinic_id = ${clinicId} AND id = ${invoiceId} FOR SHARE`,
  )) as unknown as {
    number: string;
    total_minor: string;
    currency: InvoiceSubject["currency"];
    currency_exponent: number;
    status: InvoiceSubject["status"];
  }[];
  return row === undefined
    ? null
    : {
        number: row.number,
        totalMinor: row.total_minor,
        currency: row.currency,
        currencyExponent: Number(row.currency_exponent),
        status: row.status,
      };
}
