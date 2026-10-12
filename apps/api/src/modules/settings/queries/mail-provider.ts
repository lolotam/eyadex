import type { MailProviderResponse, MailProvidersResponse } from "@eyadex/contracts/mail-provider";
import type { MailProviderSlot } from "@eyadex/contracts/notifications";
import type { Database } from "@eyadex/db";

import { mailProviderView } from "../domain/mail-provider-rules.ts";
import { findMailProvider } from "../persistence/pg-mail-provider-store.ts";

/**
 * عرض مزود خانة واحدة من بريد العيادة، أو `null` لو مفيش. عمره ما فيه المفتاح ولا كلمة السر.
 *
 * @param db pool العيادة
 * @param clinicId العيادة
 * @param slot الخانة (المسار القديم `/clinic/mail-provider` = الأساسي)
 * @returns العرض أو `null`
 */
export function getMailProvider(
  db: Database,
  clinicId: string,
  slot: MailProviderSlot,
): Promise<MailProviderResponse> {
  return db.withTenant(clinicId, async (tx) => {
    const row = await findMailProvider(tx, clinicId, slot);
    return row === null ? null : mailProviderView(row);
  });
}

/**
 * الخانتين مع بعض في transaction واحدة (N-3)، كل واحدة عرضها أو `null`.
 *
 * @param db pool العيادة
 * @param clinicId العيادة
 * @returns الأساسي والاحتياطي
 */
export function getMailProviders(db: Database, clinicId: string): Promise<MailProvidersResponse> {
  return db.withTenant(clinicId, async (tx) => {
    const primary = await findMailProvider(tx, clinicId, "primary");
    const fallback = await findMailProvider(tx, clinicId, "fallback");
    return {
      primary: primary === null ? null : mailProviderView(primary),
      fallback: fallback === null ? null : mailProviderView(fallback),
    };
  });
}
