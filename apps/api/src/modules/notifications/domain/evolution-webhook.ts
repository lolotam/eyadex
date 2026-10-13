import { z } from "zod";

const envelope = z.object({
  event: z.string(),
  instance: z.string(),
  data: z.unknown().optional(),
});
const message = z.object({
  status: z.union([z.string(), z.number()]).optional(),
  keyId: z.string().min(1).max(200).optional(),
  key: z.object({ id: z.string().min(1).max(200).optional() }).optional(),
});
const connection = z.object({ state: z.string() });

export type EvolutionWebhookEvent =
  | { readonly kind: "rejected"; readonly clinicId: string; readonly messageId: string }
  | { readonly kind: "closed"; readonly clinicId: string };

/**
 * يقرأ الأحداث المطلوبة فقط ويهمل الردود المجهولة؛ الجسم الخارجي لا يُسجّل.
 * @param body جسم webhook غير الموثوق
 * @returns أحداث آمنة محدودة أو قائمة فارغة
 */
export function parseEvolutionWebhook(body: unknown): EvolutionWebhookEvent[] {
  const parsed = envelope.safeParse(body);
  if (!parsed.success || !parsed.data.instance.startsWith("eyadex-")) return [];
  const uuid = z.string().uuid().safeParse(parsed.data.instance.slice(7));
  if (!uuid.success) return [];
  const clinicId = uuid.data;
  const event = parsed.data.event.toUpperCase().replaceAll(".", "_");
  if (event === "CONNECTION_UPDATE") {
    const state = connection.safeParse(parsed.data.data);
    return state.success && state.data.state === "close" ? [{ kind: "closed", clinicId }] : [];
  }
  if (event !== "MESSAGES_UPDATE") return [];
  const updates = Array.isArray(parsed.data.data) ? parsed.data.data : [parsed.data.data];
  return updates.flatMap((update): EvolutionWebhookEvent[] => {
    const parsedMessage = message.safeParse(update);
    if (!parsedMessage.success) return [];
    const { status, keyId, key } = parsedMessage.data;
    const messageId = keyId ?? key?.id;
    return (status === "ERROR" || status === 0) && messageId !== undefined
      ? [{ kind: "rejected", clinicId, messageId }]
      : [];
  });
}
