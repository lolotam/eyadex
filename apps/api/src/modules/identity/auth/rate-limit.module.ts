import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";

import { readAuthConfig } from "./auth-config.ts";
import { RateLimiter } from "./rate-limiter.ts";
import { RedisCounterStore } from "./redis-counter-store.ts";

/** Token الـ DI لـ `AuthRateLimit`. */
export const AUTH_RATE_LIMIT = Symbol("identity.AuthRateLimit");

/** الـ limiter والاتصال بتاعه، عشان يتقفلوا مع الـ app. */
export interface AuthRateLimit {
  readonly limiter: RateLimiter;
  close(): Promise<void>;
}

/**
 * بيبني الـ limiter على Redis. مفيش طابور offline ولا retry للأمر: لو Redis واقع الأمر بيفشل فورًا،
 * والـ handler بيقفل الطلب بدل ما يستنى أو يعدّيه (ADR-0005).
 *
 * @param redisUrl `REDIS_URL`
 * @param secret `BETTER_AUTH_SECRET`، مفتاح الـ HMAC للمفاتيح
 * @returns الـ limiter
 */
export function buildAuthRateLimit(redisUrl: string, secret: string): AuthRateLimit {
  const redis = new Redis(redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    commandTimeout: 1_000,
    connectTimeout: 2_000,
  });
  // Connection errors surface on each command, where the handler fails closed; this only stops
  // ioredis from printing the URL-bearing "Unhandled error event" warning.
  redis.on("error", () => undefined);
  return {
    limiter: new RateLimiter(new RedisCounterStore(redis), secret),
    close: async () => {
      try {
        await redis.quit();
      } catch {
        redis.disconnect();
      }
    },
  };
}

/** بيقفل اتصال Redis مع الـ app، زي `AuthCloser`. */
@Injectable()
export class RateLimitCloser implements OnApplicationShutdown {
  constructor(@Inject(AUTH_RATE_LIMIT) private readonly rateLimit: AuthRateLimit) {}

  async onApplicationShutdown(): Promise<void> {
    await this.rateLimit.close();
  }
}

/** الـ providers بتوع الـ rate limit، اللي `AuthModule` بيركّبهم. */
export const RATE_LIMIT_PROVIDERS = [
  {
    provide: AUTH_RATE_LIMIT,
    useFactory: () => {
      const config = readAuthConfig(process.env);
      return buildAuthRateLimit(config.REDIS_URL, config.BETTER_AUTH_SECRET);
    },
  },
  RateLimitCloser,
];
