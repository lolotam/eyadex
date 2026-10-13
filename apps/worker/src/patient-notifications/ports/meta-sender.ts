import type { FilledTemplate, WhatsappResult } from "./whatsapp-sender.ts";

/** منفذ إرسال قوالب coexistence مباشرة إلى Meta Graph v22.0. */
export interface MetaSender {
  /**
   * يرسل القالب من رقم العيادة دون المرور بـ Evolution، ولا يسجل بيانات الطلب أو الرد.
   * @param credentials معرّف الرقم والتوكن المفتوح في الذاكرة فقط
   * @param number رقم المراجع
   * @param template القالب وقيمه المرتبة
   * @returns معرّف الرسالة المقبولة أو كود فشل آمن
   */
  sendTemplate(
    credentials: { readonly phoneNumberId: string; readonly accessToken: string },
    number: string,
    template: FilledTemplate,
  ): Promise<WhatsappResult>;
}
