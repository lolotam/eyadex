import { legacyNumber } from "@eyadex/contracts/number-compat";
import { z } from "zod";

const envelope = z.object({
  event: z.string(),
  instance: z.string(),
  data: z.unknown().optional(),
});
const message = z.object({
  status: z.union([z.string(), legacyNumber()]).optional(),
  keyId: z.string().min(1).max(200).optional(),
  key: z.object({ id: z.string().min(1).max(200).optional() }).optional(),
});
const connection = z.object({ state: z.string() });

/** What one Evolution message update says about a message the clinic sent. */
export type EvolutionMessageOutcome = "rejected" | "delivered" | "read";

export type EvolutionWebhookEvent =
  | {
      readonly kind: EvolutionMessageOutcome;
      readonly clinicId: string;
      readonly messageId: string;
    }
  | { readonly kind: "closed"; readonly clinicId: string };

// Baileys' ack levels as Evolution reports them, by name or by number (N2 rejection, N3 receipts).
// SERVER_ACK (2) and PENDING (1) say nothing the ledger does not already know.
const OUTCOMES = new Map<string | number, EvolutionMessageOutcome>([
  ["ERROR", "rejected"],
  [0, "rejected"],
  ["DELIVERY_ACK", "delivered"],
  [3, "delivered"],
  ["READ", "read"],
  [4, "read"],
  ["PLAYED", "read"],
  [5, "read"],
]);

/**
 * يقرأ الأحداث المطلوبة فقط ويهمل الردود المجهولة؛ الجسم الخارجي لا يُسجّل.
 * @param body جسم webhook غير الموثوق
 * @returns أحداث آمنة محدودة أو قائمة فارغة
 */
export function parseEvolutionWebhook(body: unknown): EvolutionWebhookEvent[] {
  const parsed = envelope.safeParse(body);
  if (!parsed.success || !parsed.data.instance.startsWith("eyadex-")) return [];
  const uuid = z.string().guid().safeParse(parsed.data.instance.slice(7));
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
    const outcome = status === undefined ? undefined : OUTCOMES.get(status);
    return outcome !== undefined && messageId !== undefined
      ? [{ kind: outcome, clinicId, messageId }]
      : [];
  });
}
