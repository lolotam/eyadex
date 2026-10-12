import type { MailProviderResponse, MailProvidersResponse } from "@eyadex/contracts/mail-provider";
import type { MailProviderSlot } from "@eyadex/contracts/notifications";

/** منفذ قراءة إعداد بريد العيادة للـ controller. */
export interface MailProviderReader {
  /**
   * بيرجع عرض مزود خانة واحدة من غير أي سر.
   *
   * @param clinicId العيادة
   * @param slot الخانة
   * @returns العرض، أو `null` لو مفيش إعداد في الخانة دي
   */
  read(clinicId: string, slot: MailProviderSlot): Promise<MailProviderResponse>;

  /**
   * بيرجع الخانتين (الأساسي والاحتياطي) من غير أي سر.
   *
   * @param clinicId العيادة
   * @returns الخانتين، كل واحدة عرضها أو `null`
   */
  readAll(clinicId: string): Promise<MailProvidersResponse>;
}
