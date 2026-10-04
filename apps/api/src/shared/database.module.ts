import { Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { Database } from "@eyadex/db";

import { DATABASE, databaseProvider } from "./database.provider.ts";

/**
 * يقفل الـ pool مع الـ app: `app.close()` في الاختبارات وإيقاف الـ signal في الـ deploy الاتنين بيعدّوا
 * على lifecycle بتاع Nest، فالـ sockets ما بتفضلش مفتوحة والشغل اللي شغّال بيخلص قبل الخروج
 * (`close()` بيستنى لحد مهلة الـ driver).
 */
@Injectable()
export class DatabaseCloser implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
  }
}

/**
 * الـ `Database` الوحيد في الـ app: كل موديول بيعمل import للموديول ده بدل ما يحط الـ provider
 * عنده، فـ Nest بيبني pool واحد ويقفله مرة واحدة.
 */
@Module({
  providers: [databaseProvider, DatabaseCloser],
  exports: [DATABASE],
})
export class DatabaseModule {}
