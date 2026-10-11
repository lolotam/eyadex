import type { medicineListSchema } from "@eyadex/contracts/medicines";
import type { Database } from "@eyadex/db";
import type { z } from "zod";

import { listClinicMedicines } from "../persistence/pg-medicine-store.ts";

/**
 * `GET /v1/medicines` (R3-3): the whole list, active first, then by name. Not patient data: not audited.
 *
 * @returns the clinic's medicines
 */
export function listMedicines(
  db: Database,
  clinicId: string,
): Promise<z.infer<typeof medicineListSchema>> {
  return db.withTenant(clinicId, async (tx) => ({
    items: await listClinicMedicines(tx, clinicId),
  }));
}
