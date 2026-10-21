/**
 * Role messages kept apart so the shared API catalogue stays within its file limit. `{module}` is filled by
 * the client from `details.module`, like `role_in_use`'s `{count}`.
 */
export const ROLE_ERROR_MESSAGES = {
  role_hidden_keys_invalid: {
    message_ar:
      "صلاحيات هذا الدور في قسم «{module}» المقفل تحتاج تصحيح نطاق العرض. فعّل القسم ثم صحّحها واحفظ",
    message_en:
      "This role's permissions in the switched-off {module} module need a wider view. Switch the module on, fix them and save",
  },
} satisfies Record<"role_hidden_keys_invalid", { message_ar: string; message_en: string }>;
