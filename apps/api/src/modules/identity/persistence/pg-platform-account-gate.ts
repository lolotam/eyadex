import type { Database } from "@eyadex/db";

import type { PlatformAccountGate } from "../ports/platform-account-gate.ts";
import { accountByUser } from "./pg-platform-team.ts";

/** الـ gate على pool المنصة: صف `platform_accounts` المربوط بالمستخدم وحالته `active` (0037). */
export class PgPlatformAccountGate implements PlatformAccountGate {
  constructor(private readonly db: Database) {}

  async isActive(userId: string): Promise<boolean> {
    const row = await this.db.withNoTenant((tx) => accountByUser(tx, userId));
    return row?.status === "active";
  }
}
