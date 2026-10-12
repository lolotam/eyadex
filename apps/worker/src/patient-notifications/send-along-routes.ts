import type { NotificationRoute } from "@eyadex/contracts/notifications";

import { addressOf } from "../invitation-mail/domain/mail-address.ts";
import type { MailMessage, MailResult, MailSender } from "../invitation-mail/ports/mail-sender.ts";
import { sendViaClinic, type ClinicMailDeps } from "../invitation-mail/send-via-clinic.ts";
import { certainlyNotAccepted } from "./domain/route-advance.ts";
import type { LockedProviders } from "./ports/notification-store.ts";

// One budget for the whole chain: the ledger and the patient stay locked during the send, inside a tenant
// transaction capped at 10 s (@eyadex/db), and the reads before and the writes after need headroom.
export const CHAIN_BUDGET_MS = 8_000;
// Less than this left: another provider's handshake cannot finish, so the attempt stops and resumes here.
export const MIN_ROUTE_MS = 1_000;

/** اللي سلسلة المسارات محتاجاه. */
export interface RouteDeps {
  readonly clinicMail: ClinicMailDeps;
  /** بريد المنصة (main.ts): آخر مسار، بالنيابة عن العيادة. */
  readonly platform: MailSender;
  readonly now: () => Date;
  readonly budgetMs?: number;
  readonly ms?: () => number;
}

/** المرسل بالنيابة: اسم العيادة على عنوان المنصة، والرد لعنوان العيادة لو فيه (N-3). */
export interface OnBehalf {
  readonly fromName: string;
  readonly replyTo: string | null;
}

/** نتيجة المحاولة: المسار اللي بعت، أو اللي المحاولة وقفت عنده وكوده؛ وهل مزود اتحوّل فيها. */
export type ChainResult =
  | { readonly sent: true; readonly route: NotificationRoute; readonly degraded: boolean }
  | {
      readonly sent: false;
      readonly route: NotificationRoute;
      readonly error: string;
      readonly degraded: boolean;
    };

type Attempt = { result: MailResult; degraded: boolean };

/**
 * بيمشي على المسارات بالترتيب (N-3). بينقل للي بعده بس لما الرسالة أكيد ما اتقبلتش (`certainlyNotAccepted`)؛
 * أي فشل غامض بيوقف المحاولة عند المسار ده، عشان الجاية تعيده هو ومانبعتش مرتين.
 *
 * @param deps المرسلين والميزانية
 * @param plan المسارات (`planRoutes`)
 * @param providers صفّي مزود العيادة الممسوكين
 * @param message الرسالة، ومفتاح الـ idempotency = id الحدث
 * @param onBehalf الاسم وعنوان الرد للمنصة
 * @returns النتيجة
 */
export async function sendAlongRoutes(
  deps: RouteDeps,
  plan: readonly NotificationRoute[],
  providers: LockedProviders,
  message: MailMessage,
  onBehalf: OnBehalf,
): Promise<ChainResult> {
  const ms = deps.ms ?? Date.now;
  const budget = deps.budgetMs ?? CHAIN_BUDGET_MS;
  const startedAt = ms();
  let degraded = false;
  let last: ChainResult = { sent: false, route: "platform", error: "no_route", degraded };
  for (const route of plan) {
    const left = budget - (ms() - startedAt);
    if (left < MIN_ROUTE_MS) return { sent: false, route, error: "no_time", degraded };
    const attempt = await within(left, send(deps, route, providers, message, onBehalf));
    degraded ||= attempt.degraded;
    if (attempt.result.sent) return { sent: true, route, degraded };
    last = { sent: false, route, error: attempt.result.error, degraded };
    if (!certainlyNotAccepted(attempt.result.error)) return last;
  }
  return last;
}

function send(
  deps: RouteDeps,
  route: NotificationRoute,
  providers: LockedProviders,
  message: MailMessage,
  onBehalf: OnBehalf,
): Promise<Attempt> {
  if (route === "platform") {
    // The platform's verified address with the clinic's name: never the clinic's own domain.
    return deps.platform
      .send({
        ...message,
        from: { name: onBehalf.fromName, address: addressOf(deps.clinicMail.platformFrom) },
        ...(onBehalf.replyTo === null ? {} : { replyTo: onBehalf.replyTo }),
      })
      .then((result) => ({ result, degraded: false }));
  }
  const locked = providers[route];
  // Unreachable: planRoutes only names a slot whose row exists.
  if (locked === null) {
    return Promise.resolve({ result: { sent: false, error: "no_provider" }, degraded: false });
  }
  return sendViaClinic(deps.clinicMail, locked, message, deps.now);
}

// What is left of the budget bounds this route. Running out is ambiguous (the provider may still accept
// it), so it retries this same route; the late outcome is dropped.
async function within(ms: number, sending: Promise<Attempt>): Promise<Attempt> {
  sending.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<Attempt>((resolve) => {
    timer = setTimeout(
      () => resolve({ result: { sent: false, error: "route_timeout" }, degraded: false }),
      ms,
    );
  });
  try {
    return await Promise.race([sending, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
