import { Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { systemUuidV7 } from "@eyadex/ids";

import { AREA_AUTH, buildAreaAuth, type AreaAuth } from "./area-auth.ts";
import { readAuthConfig } from "./auth-config.ts";
import { AUTH_RATE_LIMIT, RATE_LIMIT_PROVIDERS } from "./rate-limit.module.ts";
import { SessionGuard } from "./session.guard.ts";

/** بيقفل الـ pools بتاعة المنطقتين مع الـ app، زي `DatabaseCloser`. */
@Injectable()
export class AuthCloser implements OnApplicationShutdown {
  constructor(@Inject(AREA_AUTH) private readonly areaAuth: AreaAuth) {}

  async onApplicationShutdown(): Promise<void> {
    await this.areaAuth.close();
  }
}

/** instance لكل منطقة من الـ env، والـ `SessionGuard`. الـ routes بتتركّب في `startApi`. */
@Module({
  providers: [
    {
      provide: AREA_AUTH,
      useFactory: () => buildAreaAuth(readAuthConfig(process.env), systemUuidV7()),
    },
    AuthCloser,
    ...RATE_LIMIT_PROVIDERS,
    SessionGuard,
  ],
  exports: [AREA_AUTH, AUTH_RATE_LIMIT, SessionGuard],
})
export class AuthModule {}
