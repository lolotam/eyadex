import type { MailProviderResponse } from "@eyadex/contracts/mail-provider";
import type { Database } from "@eyadex/db";

import { mailProviderView } from "../domain/mail-provider-rules.ts";
import { findMailProvider } from "../persistence/pg-mail-provider-store.ts";

/**
 * عرض مزود بريد العيادة، أو `null` لو مفيش. عمره ما فيه المفتاح ولا كلمة السر.
 *
 * @param db pool العيادة
 * @param clinicId العيادة
 * @returns العرض أو `null`
 */
export function getMailProvider(db: Database, clinicId: string): Promise<MailProviderResponse> {
  return db.withTenant(clinicId, async (tx) => {
    const row = await findMailProvider(tx, clinicId);
    return row === null ? null : mailProviderView(row);
  });
}
