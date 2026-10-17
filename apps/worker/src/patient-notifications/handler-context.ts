import type { SecretSealer } from "@eyadex/secrets";
import type { MetaSender } from "./ports/meta-sender.ts";
import type { ClaimedEvent, DispatchOutcome } from "@eyadex/db";
import type { Logger } from "@eyadex/observability";

import type { MailSender } from "../invitation-mail/ports/mail-sender.ts";
import type { ClinicMailDeps } from "../invitation-mail/send-via-clinic.ts";
import type { InvoiceLinkStore } from "./ports/invoice-links.ts";
import type { NotificationStore, ReadyNotification } from "./ports/notification-store.ts";
import type { WhatsappSender } from "./ports/whatsapp-sender.ts";
import type { FieldOpener } from "./prescription-lines.ts";

export interface NotificationDispatchDeps {
  readonly store: NotificationStore;
  /**
   * روابط الفواتير (C1): المخزن، وختم `INVOICE_LINK_SEAL_KEY` (`null` لو مش مضبوط: رسايل الفواتير بتستنى
   * وباقي الأنواع ماشية)، وأصل منطقة العيادات اللي الرابط بيتبني عليه.
   */
  readonly invoiceLinks: {
    readonly store: InvoiceLinkStore;
    readonly sealer: SecretSealer | null;
    readonly appUrl: string;
  };
  /** مزودي العيادة: الختم والمصنع وعنوان المنصة للإرسال بالنيابة. */
  readonly clinicMail: ClinicMailDeps;
  /** بريد المنصة (main.ts): آخر مسار، بالنيابة عن العيادة (N-3). */
  readonly platform: MailSender;
  /** Evolution (spec §7.1)؛ `null` لو `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` مش مضبوطين: واتساب متخطّي. */
  readonly whatsapp: WhatsappSender | null;
  readonly meta?: MetaSender;
  readonly whatsappSealer?: SecretSealer;
  /** فاتح سطور الوصفة (ADR-0028)؛ `null` لو مفاتيح `MEDICAL_MASTER_KEY_V<n>` مش مضبوطة في الـ worker. */
  readonly cipher: FieldOpener | null;
  readonly clock: { now(): Date };
  /** عشوائي في `[0, 1)` لتذبذب الطابور؛ الافتراضي `Math.random`. */
  readonly random?: () => number;
  readonly logger: Logger;
  /** ميزانية سلسلة المسارات؛ الافتراضي `CHAIN_BUDGET_MS`. */
  readonly budgetMs?: number;
}

/** اللي معالج القناة محتاجه من الـ dispatcher: الاعتماديات وطرق إنهاء الحدث والسطر المسجّل. */
export interface HandlerContext {
  readonly deps: NotificationDispatchDeps;
  /** سطر بالأكواد بس (مفيش عنوان ولا نص). */
  note(event: ClaimedEvent, outcome: string, extra?: Record<string, unknown>): void;
  /** الحدث بيتقفل `failed`. */
  failed(event: ClaimedEvent, error: string): DispatchOutcome;
  /** فشل مالوش علاج: صف الدفتر `failed` والحدث كمان. */
  broken(event: ClaimedEvent, state: ReadyNotification, error: string): Promise<DispatchOutcome>;
}

/** الحدث اللي بيتبعت: عيادته، ورابط الفاتورة لو رسالة فاتورة (في الذاكرة بس، عمره ما بيتسجّل). */
export interface SendTarget {
  readonly clinicId: string;
  readonly invoiceUrl: string | null;
}

export const DONE: DispatchOutcome = { kind: "dispatched" };
