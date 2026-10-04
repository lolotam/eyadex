const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * الـ id بيروح كـ bound parameter في `set_config`، فأي قيمة غلط بتتحوّل لـ `22P02` جوّه الـ policy
 * ورا الـ RLS ومن غير ما نعرف مينبعتها. الفحص هنا بيوقّعها بيه: اسم الـ wrapper واسم الـ id.
 *
 * @param value القيمة اللي جاية من الـ caller
 * @param name اسم الـ parameter عشان الرسالة تقول لواحد
 * @returns نفس القيمة لو UUID
 */
export function assertUuid(value: string, name: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TypeError(`${name} must be a UUID`);
  }
  return value;
}
