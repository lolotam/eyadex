import { Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDatabase, type Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";
import { z } from "zod";

/** Token الـ DI للـ `Database` على الدور `eyadex_platform` (PRD §4.5). */
export const PLATFORM_DATABASE = Symbol("shared.PlatformDatabase");

// Read only when the platform module is mounted. The error names the keys, never a value.
const schema = z.object({
  PLATFORM_DATABASE_URL: z.string().url(),
  OUTBOX_SEAL_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64"),
});

export type PlatformConfig = z.output<typeof schema>;

/**
 * بيقرا إعدادات المنصة من الـ env.
 *
 * @param env الـ process environment
 * @returns الإعدادات بعد التحقق
 */
export function readPlatformConfig(env: NodeJS.ProcessEnv): PlatformConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid platform configuration: ${keys.join(", ")} — see .env.example`);
  }
  return result.data;
}

/** بيقفل الـ pool بتاع المنصة مع الـ app، زي `DatabaseCloser`. */
@Injectable()
export class PlatformDatabaseCloser implements OnApplicationShutdown {
  constructor(@Inject(PLATFORM_DATABASE) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
  }
}

/** Pool واحد على `eyadex_platform`؛ مفيش أي grant على المراجعين للدور ده (PLAT-01). */
@Module({
  providers: [
    {
      provide: PLATFORM_DATABASE,
      useFactory: (): Database =>
        createDatabase({
          url: readPlatformConfig(process.env).PLATFORM_DATABASE_URL,
          role: "eyadex_platform",
          ids: systemUuidV7(),
        }),
    },
    PlatformDatabaseCloser,
  ],
  exports: [PLATFORM_DATABASE],
})
export class PlatformDatabaseModule {}
