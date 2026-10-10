import type { Tx } from "@eyadex/db";

/** ملف مراجع زي ما موديول المواعيد محتاجه: اسمه ورقم ملفه وهل هو نشط. مفيش تليفون ولا رقم مدني. */
export interface BookingPatient {
  readonly id: string;
  readonly fullName: string;
  readonly fileNumber: number;
  readonly active: boolean;
}

/**
 * اللي موديول المواعيد محتاجه من ملفات المراجعين (ملك patients)، جوه الـ transaction بتاعته. الـ port ده
 * بتاع المواعيد، وموديول المراجعين بينفّذه (`PgBookingPatients`)، والربط في `appointments.module.ts` بس
 * (ADR-0026 §11، CLAUDE.architecture.md §2.2).
 */
export interface BookingPatientReader {
  /**
   * الملف وصفّه مقفول `FOR SHARE` لحد آخر الـ transaction (ترتيب الأقفال ADR-0027): أرشفته في نفس اللحظة
   * بتستنى، فالحجز عمره ما يتسجّل على ملف اتأرشف قبله.
   *
   * @param tx transaction المواعيد جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param patientId الملف
   * @returns الملف، أو `null` لو مش ملف في العيادة دي
   */
  lockForBooking(tx: Tx, clinicId: string, patientId: string): Promise<BookingPatient | null>;

  /**
   * أسماء وأرقام ملفات لعرض المواعيد، في جملة واحدة.
   *
   * @param tx transaction المواعيد جوه `withTenant(clinicId)`
   * @param clinicId العيادة
   * @param patientIds الملفات
   * @returns كل ملف موجود بالمعرّف بتاعه
   */
  labels(
    tx: Tx,
    clinicId: string,
    patientIds: readonly string[],
  ): Promise<ReadonlyMap<string, BookingPatient>>;
}
