import { createHmac } from "node:crypto";

import type { AuthArea } from "@eyadex/auth";

/** حد ثابت: أقصى عدد محاولات جوّه نافذة زمنية. */
export interface Limit {
  readonly max: number;
  readonly windowMs: number;
}

/** عدّاد واحد اتزوّد: قيمته الحالية والوقت الباقي على نهاية نافذته. */
export interface CounterHit {
  readonly count: number;
  readonly ttlMs: number;
}

/** مخزن العدّادات (Redis في الإنتاج). لازم الزيادة وضبط الانتهاء يحصلوا في خطوة ذرّية واحدة. */
export interface CounterStore {
  /**
   * بيزوّد العدّاد واحد، وبيبدأ نافذته لو كان جديد.
   *
   * @param key مفتاح العدّاد
   * @param windowMs طول النافذة بالملّي ثانية
   * @returns العدد الحالي والوقت الباقي
   */
  increment(key: string, windowMs: number): Promise<CounterHit>;
}

/** بُعد واحد بيتعدّ لطلب: مثلاً عنوان الـ IP أو الإيميل. */
export interface RateRule {
  readonly route: string;
  readonly dimension: string;
  readonly value: string;
  readonly limit: Limit;
}

/** نتيجة الفحص: مسموح ولا لأ، وبعد كام ثانية يقدر يحاول تاني. */
export interface RateDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

/**
 * عدّاد بنافذة ثابتة لكل بُعد. المفتاح مابيشيلش بيانات شخصية: القيمة بتتحوّل HMAC-SHA256 بالسر.
 * أي خطأ من المخزن بيطلع زي ما هو — اللي بينادي بيقفل الطلب (fail closed، ADR-0005).
 */
export class RateLimiter {
  constructor(
    private readonly store: CounterStore,
    private readonly secret: string,
    private readonly prefix = "eyadex:rl",
  ) {}

  /**
   * مفتاح العدّاد في Redis.
   *
   * @param area المنطقة
   * @param rule البُعد
   * @returns `eyadex:rl:<area>:<route>:<dimension>:<hmac hex>`
   */
  key(area: AuthArea, rule: RateRule): string {
    const digest = createHmac("sha256", this.secret).update(rule.value).digest("hex");
    return `${this.prefix}:${area}:${rule.route}:${rule.dimension}:${digest}`;
  }

  /**
   * بيعدّ الطلب على الأبعاد بالترتيب، وبيقف عند أول بُعد عدّى حدّه: الأبعاد اللي بعده ماتتعدّش.
   * اللي بينادي بيحط البُعد قليل التنوّع (الـ IP) الأول، فـ IP محظور مايقدرش يفتح مفتاح Redis جديد
   * لكل إيميل عشوائي ويملا الذاكرة — وبعدها الدخول كله يقف لأن الـ limiter بيقفل لو Redis وقع.
   *
   * @param area المنطقة
   * @param rules الأبعاد اللي بتتعدّ للطلب ده، الأقل تنوّعاً الأول
   * @returns القرار وعدد ثواني الانتظار (صفر لو مسموح)
   */
  async check(area: AuthArea, rules: readonly RateRule[]): Promise<RateDecision> {
    for (const rule of rules) {
      const hit = await this.store.increment(this.key(area, rule), rule.limit.windowMs);
      if (hit.count > rule.limit.max) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(hit.ttlMs / 1000)) };
      }
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
