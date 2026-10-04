import type { Provider } from "@nestjs/common";
import { createDatabase, type Database } from "@eyadex/db";
import { systemUuidV7 } from "@eyadex/ids";

import { readConfig } from "./config.ts";

/** Token الـ DI للـ `Database` على الدور `eyadex_app`. */
export const DATABASE = Symbol("shared.Database");

/**
 * الـ `Database` من `DATABASE_URL` على `eyadex_app`. postgres.js كسلان، فمفيش اتصال لحد أول query.
 * TODO(spec): مين بيقفل الـ pool عند الإيقاف لما الموديول يتربط في الـ app (shutdown hook).
 */
export const databaseProvider: Provider<Database> = {
  provide: DATABASE,
  useFactory: (): Database => {
    const { DATABASE_URL } = readConfig(process.env);
    if (DATABASE_URL === undefined) {
      throw new Error("DATABASE_URL is not set — see .env.example");
    }
    return createDatabase({ url: DATABASE_URL, role: "eyadex_app", ids: systemUuidV7() });
  },
};
