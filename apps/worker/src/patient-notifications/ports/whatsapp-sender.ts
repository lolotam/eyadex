/**
 * نتيجة إرسال واتساب. `error` كود قصير بس (`evo_*`)، عمره ما بيحمل الرقم ولا النص ولا جسم الرد، لأنه
 * بيتكتب في `last_error` وفي السطور.
 */
export type WhatsappResult =
  | { readonly sent: true; readonly messageId: string }
  | { readonly sent: false; readonly error: string };

/** قالب Meta متعبّي (coexistence): الاسم واللغة وقيم الجسم بالترتيب. */
export interface FilledTemplate {
  readonly name: string;
  readonly language: string;
  readonly parameters: readonly string[];
}

/**
 * منفذ واتساب (spec §7.1): Evolution API على الشبكة الداخلية، instance لكل عيادة. مابيرميش لخطأ شبكة أو
 * رد مرفوض — بيرجع `{ sent: false, error }` عشان المعالج يحسب المحاولة الجاية.
 */
export interface WhatsappSender {
  /**
   * رسالة نص عادية من رقم العيادة (`evolution`).
   *
   * @param instance اسم instance العيادة في Evolution
   * @param number رقم المراجع أرقام بس (`965` و8 أرقام)
   * @param text نص الرسالة
   * @returns اتبعت، أو كود الفشل
   */
  sendText(instance: string, number: string, text: string): Promise<WhatsappResult>;
}
