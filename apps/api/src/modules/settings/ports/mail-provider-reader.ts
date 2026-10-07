import type { MailProviderResponse } from "@eyadex/contracts/mail-provider";

/** منفذ قراءة إعداد بريد العيادة للـ controller. */
export interface MailProviderReader {
  /**
   * بيرجع عرض المزود من غير أي سر.
   *
   * @param clinicId العيادة
   * @returns العرض، أو `null` لو مفيش إعداد
   */
  read(clinicId: string): Promise<MailProviderResponse>;
}
