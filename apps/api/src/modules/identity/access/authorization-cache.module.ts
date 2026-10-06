import { Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";

import { readAuthConfig } from "../auth/auth-config.ts";
import { AUTHORIZATION_INVALIDATOR } from "../ports/authorization-invalidator.ts";
import { AuthorizationCache } from "./authorization-cache.ts";

const AUTHZ_REDIS = Symbol("identity.AuthzRedis");

/** بيقفل اتصال Redis بتاع الكاش مع الـ app. */
@Injectable()
export class AuthzRedisCloser implements OnApplicationShutdown {
  constructor(@Inject(AUTHZ_REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

/**
 * The versioned authorization cache (ADR-0009) and its invalidation port, on its own so the platform
 * module can invalidate a clinic without mounting the clinic routes. Needs REDIS_URL.
 */
@Module({
  providers: [
    {
      provide: AUTHZ_REDIS,
      useFactory: () => {
        // Short timeouts: a slow Redis must cost a request little before it falls back to the DB.
        const redis = new Redis(readAuthConfig(process.env).REDIS_URL, {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 0,
          commandTimeout: 250,
          connectTimeout: 1_000,
        });
        redis.on("error", () => undefined);
        return redis;
      },
    },
    AuthzRedisCloser,
    {
      provide: AuthorizationCache,
      inject: [AUTHZ_REDIS],
      useFactory: (r: Redis) => new AuthorizationCache(r),
    },
    { provide: AUTHORIZATION_INVALIDATOR, useExisting: AuthorizationCache },
  ],
  exports: [AuthorizationCache, AUTHORIZATION_INVALIDATOR],
})
export class AuthorizationCacheModule {}
