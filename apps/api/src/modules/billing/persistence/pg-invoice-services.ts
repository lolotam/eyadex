import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

export interface InvoiceServiceFacts {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly priceMinor: string | null;
  readonly providerPrices: ReadonlyMap<string, string>;
}

/** أسماء وأسعار سطور الطلب في قراءة واحدة تحت RLS؛ الخدمات المؤرشفة بتفضل ظاهرة للفواتير القديمة. */
export async function invoiceServiceFacts(
  tx: Tx,
  clinicId: string,
  serviceIds: readonly string[],
): Promise<ReadonlyMap<string, InvoiceServiceFacts>> {
  const unique = [...new Set(serviceIds)];
  if (unique.length === 0) return new Map();
  const rows = await tx.execute<{
    id: string;
    name_ar: string;
    name_en: string;
    price_minor: string | null;
    member_id: string | null;
    provider_price_minor: string | null;
  }>(
    sql`SELECT s.id, s.name_ar, s.name_en, s.price_minor::text,
          p.member_id, p.price_minor::text AS provider_price_minor
        FROM clinic_services s LEFT JOIN service_provider_prices p
          ON p.clinic_id = s.clinic_id AND p.service_id = s.id
        WHERE s.clinic_id = ${clinicId} AND s.id IN (${sql.join(
          unique.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
  );
  const facts = new Map<string, InvoiceServiceFacts & { providerPrices: Map<string, string> }>();
  for (const row of rows) {
    const fact = facts.get(row.id) ?? {
      nameAr: row.name_ar,
      nameEn: row.name_en,
      priceMinor: row.price_minor,
      providerPrices: new Map<string, string>(),
    };
    if (row.member_id !== null && row.provider_price_minor !== null) {
      fact.providerPrices.set(row.member_id, row.provider_price_minor);
    }
    facts.set(row.id, fact);
  }
  return facts;
}
