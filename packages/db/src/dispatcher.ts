import postgres from "postgres";

import { asDatabaseError } from "./database-error.ts";

/** الدور الوحيد اللي `createDispatcherOutbox` بيقبله (PRD §4.5): الـ outbox وبس، مفيش جدول عيادة. */
export type DispatcherRole = "eyadex_dispatcher";
const ROLE: DispatcherRole = "eyadex_dispatcher";

/** إعدادات الـ pool بتاع الـ dispatcher — متحقنة من الـ composition root زي `DatabaseOptions`. */
export interface DispatcherOptions {
  /** رابط `eyadex_dispatcher`. ما بيتسجلش في أي سطر ولا رسالة خطأ. */
  readonly url: string;
  /** حجم الـ pool: 1..20، الافتراضي 2. */
  readonly maxConnections?: number;
  /**
   * سقف الـ transaction بالـ ms: 1000..120000، الافتراضي 30000. الـ claim بيفضل ماسك الصف لحد ما
   * الإرسال يخلص، فالسقف لازم يغطي مهلة مزود الإيميل.
   */
  readonly transactionTimeoutMs?: number;
  /** سقف فتح الـ connection بالثواني: 1..60، الافتراضي 10. */
  readonly connectTimeoutSeconds?: number;
}

/** حدث اتمسك للإرسال. الـ payload نسخة مقروءة؛ أي تعديل بيعدّي على النتيجة بس. */
export interface ClaimedEvent {
  readonly id: string;
  readonly clinicId: string | null;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly attempts: number;
  readonly createdAt: Date;
}

/**
 * نتيجة حدث: `dispatched` (اتبعت أو اتشال من غير إرسال) و`failed` بيمسحوا `sealedToken` من الـ
 * payload في نفس الـ UPDATE؛ `retry` بيسيبه عشان المحاولة الجاية. `deferred` = الحدث ماتجرّبش أصلاً
 * (مثلاً دوره في طابور الإرسال لسه ماجاش، spec الإشعارات §7.1): بيتأجل لـ `nextAttemptAt` من غير ما
 * يتحسب محاولة ومن غير ما يلمس `last_error`.
 */
export type DispatchOutcome =
  | { readonly kind: "dispatched" }
  | { readonly kind: "retry"; readonly error: string; readonly nextAttemptAt: Date }
  | { readonly kind: "deferred"; readonly nextAttemptAt: Date }
  | { readonly kind: "failed"; readonly error: string };

/** الدفاتر التقنية اللي ليها مدة احتفاظ (ADR-0022). */
export type RetentionTarget = "outbox" | "platformLedger" | "clinicLedger";

/** اللي الـ worker بياخده من الـ outbox: claim واحد في كل transaction، purge، ping، close. مفيش SQL حر. */
export interface DispatcherOutbox {
  /**
   * بيمسك أقدم حدث جاهز من الأنواع دي (`FOR UPDATE SKIP LOCKED`، فـ worker تاني ما بيشوفوش)، بينفّذ
   * `handle` والصف لسه ممسوك، وبيكتب النتيجة في نفس الـ transaction. لو `handle` رمى، الـ transaction
   * بيترجع والحدث بيفضل زي ما هو.
   *
   * @param types أنواع الأحداث اللي الـ worker بيفهمها؛ أي نوع تاني ما بيتلمسش
   * @param now وقت الـ worker (الساعة المتحقنة): حدث `next_attempt_at` بتاعه بعده ما بيتمسكش
   * @param handle بيقرر النتيجة
   * @returns الحدث ونتيجته، أو `null` لو مفيش حاجة جاهزة
   */
  claimNext(
    types: readonly string[],
    now: Date,
    handle: (event: ClaimedEvent) => Promise<DispatchOutcome>,
  ): Promise<{ readonly event: ClaimedEvent; readonly outcome: DispatchOutcome } | null>;
  /**
   * دفعة واحدة من الحذف بعد مدة الاحتفاظ (0040، ADR-0022) في transaction خاصة بيها. المدة والحد
   * الأقصى للدفعة جوه الـ function نفسها، فالـ caller مايقدرش يوصل لصف جديد ولا لحدث لسه ماخلصش.
   *
   * @param target الدفتر: الـ outbox، أو مفاتيح المنصة، أو مفاتيح العيادات
   * @param limit أقصى عدد صفوف في الدفعة (1..1000، الـ function بترفض غير كده)
   * @returns عدد الصفوف اللي اتمسحت
   */
  purgeExpired(target: RetentionTarget, limit: number): Promise<number>;
  /** للـ readiness: نفس فحص الدور جوه transaction قصير. */
  ping(): Promise<void>;
  /** قفل محدود للـ pool. */
  close(): Promise<void>;
}

// One fixed statement per ledger: the function names are the whole SQL surface of a purge (0040).
const PURGES: Record<
  RetentionTarget,
  (tx: postgres.TransactionSql, limit: number) => Promise<{ deleted: number }[]>
> = {
  outbox: (tx, limit) => tx`SELECT purge_expired_outbox_events(${limit}::integer) AS deleted`,
  platformLedger: (tx, limit) =>
    tx`SELECT purge_expired_idempotency_keys(${limit}::integer) AS deleted`,
  clinicLedger: (tx, limit) =>
    tx`SELECT purge_expired_clinic_idempotency_keys(${limit}::integer) AS deleted`,
};

const LAST_ERROR_MAX = 500;
const between = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;

type Row = {
  id: string;
  clinic_id: string | null;
  event_type: string;
  payload: string;
  attempts: number;
  created_at: string;
};

/**
 * بيفتح pool على `eyadex_dispatcher` (كسلان، مفيش اتصال لحد أول claim). كل transaction بتتأكد إن
 * الدور هو `eyadex_dispatcher` بالظبط ومش متفوّت ولا عضو في دور تاني، وبتحط سقوف الوقت.
 *
 * @param options الرابط وحجم الـ pool والسقوف
 * @returns الـ outbox بتاع الـ dispatcher
 */
export function createDispatcherOutbox(options: DispatcherOptions): DispatcherOutbox {
  const url = options.url;
  if (typeof url !== "string" || url.trim() === "") {
    throw new TypeError("options.url must be a non-empty connection string");
  }
  const max = options.maxConnections ?? 2;
  const timeoutMs = options.transactionTimeoutMs ?? 30_000;
  const connectTimeout = options.connectTimeoutSeconds ?? 10;
  if (!between(max, 1, 20)) throw new TypeError("options.maxConnections must be 1..20");
  if (!between(timeoutMs, 1000, 120_000)) {
    throw new TypeError("options.transactionTimeoutMs must be 1000..120000");
  }
  if (!between(connectTimeout, 1, 60)) {
    throw new TypeError("options.connectTimeoutSeconds must be 1..60");
  }
  const client = postgres(url, {
    max,
    connect_timeout: connectTimeout,
    fetch_types: false,
    onnotice: () => undefined,
    connection: { application_name: "eyadex-dispatcher" },
  });

  const open = async (tx: postgres.TransactionSql): Promise<void> => {
    const limit = `${timeoutMs}ms`;
    const [facts] = await tx<{ ok: boolean }[]>`
      SELECT current_user = ${ROLE} AND session_user = ${ROLE}
             AND NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user)
             AND NOT EXISTS (SELECT 1 FROM pg_auth_members m
                             WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user))
             AND set_config('statement_timeout', ${limit}, true) IS NOT NULL
             AND set_config('idle_in_transaction_session_timeout', ${limit}, true) IS NOT NULL
             AS ok`;
    if (facts?.ok !== true) {
      throw new Error("the dispatcher URL must sign in as eyadex_dispatcher (no BYPASSRLS)");
    }
  };

  const write = async (
    tx: postgres.TransactionSql,
    id: string,
    outcome: DispatchOutcome,
    now: Date,
  ) => {
    const at = now.toISOString();
    if (outcome.kind === "dispatched") {
      await tx`UPDATE outbox_events SET dispatched_at = ${at}::timestamptz,
                 payload = payload - 'sealedToken', next_attempt_at = NULL WHERE id = ${id}`;
    } else if (outcome.kind === "deferred") {
      // Not an attempt: attempts and last_error stay as the last real attempt left them.
      await tx`UPDATE outbox_events
                 SET next_attempt_at = ${outcome.nextAttemptAt.toISOString()}::timestamptz WHERE id = ${id}`;
    } else if (outcome.kind === "retry") {
      await tx`UPDATE outbox_events SET attempts = attempts + 1,
                 next_attempt_at = ${outcome.nextAttemptAt.toISOString()}::timestamptz,
                 last_error = ${outcome.error.slice(0, LAST_ERROR_MAX)} WHERE id = ${id}`;
    } else {
      await tx`UPDATE outbox_events SET attempts = attempts + 1, failed_at = ${at}::timestamptz,
                 next_attempt_at = NULL, last_error = ${outcome.error.slice(0, LAST_ERROR_MAX)},
                 payload = payload - 'sealedToken' WHERE id = ${id}`;
    }
  };

  return {
    claimNext: async (types, now, handle) => {
      if (types.length === 0) return null;
      try {
        return await client.begin(async (tx) => {
          await open(tx);
          const [row] = await tx<Row[]>`
            SELECT id, clinic_id, event_type, payload::text AS payload, attempts, created_at::text AS created_at
            FROM outbox_events
            WHERE dispatched_at IS NULL AND failed_at IS NULL
              AND (next_attempt_at IS NULL OR next_attempt_at <= ${now.toISOString()}::timestamptz)
              AND event_type IN ${tx([...types])}
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1`;
          if (row === undefined) return null;
          const event: ClaimedEvent = {
            id: row.id,
            clinicId: row.clinic_id,
            type: row.event_type,
            payload: JSON.parse(row.payload) as Record<string, unknown>,
            attempts: row.attempts,
            createdAt: new Date(row.created_at),
          };
          const outcome = await handle(event);
          await write(tx, event.id, outcome, now);
          return { event, outcome };
        });
      } catch (error) {
        throw asDatabaseError(error);
      }
    },
    purgeExpired: async (target, limit) => {
      const purge = Object.hasOwn(PURGES, target) ? PURGES[target] : undefined;
      if (purge === undefined) throw new TypeError("unknown retention target");
      try {
        return await client.begin(async (tx) => {
          await open(tx);
          const [row] = await purge(tx, limit);
          return row?.deleted ?? 0;
        });
      } catch (error) {
        throw asDatabaseError(error);
      }
    },
    ping: async () => {
      try {
        await client.begin(open);
      } catch (error) {
        throw asDatabaseError(error);
      }
    },
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}
