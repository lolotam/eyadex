import type { CurrencyCode } from "@eyadex/contracts/money";
import type { ServicePrice } from "@eyadex/contracts/finance";
import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

// SQL on clinic_services.price_minor and service_provider_prices (0060). Every function runs inside the
// caller's withTenant(clinicId). Amounts come back as text, so a bigint never passes through a JS number.

/**
 * The clinic's finance lock (R2-3): the same key finance_set_currency (0061) and the first issue take,
 * so a currency change never races a first price.
 */
export async function lockClinicFinance(tx: Tx, clinicId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`finance:${clinicId}`}, 0))`,
  );
}

/** The clinic's currency and its minor-unit exponent. */
export async function clinicCurrency(
  tx: Tx,
  clinicId: string,
): Promise<{ currency: CurrencyCode; currencyExponent: number }> {
  const [row] = await tx.execute<{ currency: CurrencyCode; currency_exponent: number }>(
    sql`SELECT currency, currency_exponent FROM clinics WHERE id = ${clinicId}`,
  );
  return { currency: row!.currency, currencyExponent: row!.currency_exponent };
}

/** The service exists in this clinic (any status: an inactive service keeps its price). */
export async function serviceExists(tx: Tx, clinicId: string, serviceId: string): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(
    sql`SELECT id FROM clinic_services WHERE clinic_id = ${clinicId} AND id = ${serviceId}`,
  );
  return rows.length > 0;
}

export async function setBasePrice(
  tx: Tx,
  clinicId: string,
  serviceId: string,
  priceMinor: string | null,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`UPDATE clinic_services SET price_minor = ${priceMinor}::bigint,
          updated_at = ${now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${serviceId}`,
  );
}

/** Replaces the service's whole per-doctor list (the table allows DELETE, like provider_schedules). */
export async function replaceProviderPrices(
  tx: Tx,
  clinicId: string,
  serviceId: string,
  items: readonly { id: string; memberId: string; priceMinor: string }[],
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`DELETE FROM service_provider_prices WHERE clinic_id = ${clinicId} AND service_id = ${serviceId}`,
  );
  const at = now.toISOString();
  for (const item of items) {
    await tx.execute(
      sql`INSERT INTO service_provider_prices
            (clinic_id, id, service_id, member_id, price_minor, created_at, updated_at)
          VALUES (${clinicId}, ${item.id}, ${serviceId}, ${item.memberId},
            ${item.priceMinor}::bigint, ${at}::timestamptz, ${at}::timestamptz)`,
    );
  }
}

/**
 * The name and status of every service of the clinic, for the price list.
 *
 * @returns a map from service id to its names and status
 */
export async function serviceLabels(
  tx: Tx,
  clinicId: string,
): Promise<ReadonlyMap<string, { nameAr: string; nameEn: string; status: "active" | "inactive" }>> {
  const rows = await tx.execute<{
    id: string;
    name_ar: string;
    name_en: string;
    status: "active" | "inactive";
  }>(sql`SELECT id, name_ar, name_en, status FROM clinic_services WHERE clinic_id = ${clinicId}`);
  return new Map(
    rows.map((r) => [r.id, { nameAr: r.name_ar, nameEn: r.name_en, status: r.status }]),
  );
}

/**
 * Every service's prices, or one service's when `serviceId` is given; per-doctor prices by member id.
 *
 * @returns the prices, services in creation order
 */
export async function readPrices(
  tx: Tx,
  clinicId: string,
  serviceId: string | null = null,
): Promise<ServicePrice[]> {
  const rows = await tx.execute<{
    service_id: string;
    price_minor: string | null;
    member_id: string | null;
    provider_price_minor: string | null;
  }>(
    sql`SELECT s.id AS service_id, s.price_minor::text AS price_minor, p.member_id,
          p.price_minor::text AS provider_price_minor
        FROM clinic_services s
        LEFT JOIN service_provider_prices p ON p.clinic_id = s.clinic_id AND p.service_id = s.id
        WHERE s.clinic_id = ${clinicId}
          AND (${serviceId}::uuid IS NULL OR s.id = ${serviceId}::uuid)
        ORDER BY s.id, p.member_id`,
  );
  const prices = new Map<string, ServicePrice>();
  for (const row of rows) {
    const entry = prices.get(row.service_id) ?? {
      serviceId: row.service_id,
      priceMinor: row.price_minor,
      providerPrices: [],
    };
    if (row.member_id !== null && row.provider_price_minor !== null) {
      entry.providerPrices.push({ memberId: row.member_id, priceMinor: row.provider_price_minor });
    }
    prices.set(row.service_id, entry);
  }
  return [...prices.values()];
}

/**
 * The price an invoice line starts from (FIN-A8): the doctor's own price for the service, else its base
 * price, else null (`price_missing`). With no doctor, the base price.
 */
export async function effectivePrice(
  tx: Tx,
  clinicId: string,
  serviceId: string,
  memberId: string | null,
): Promise<string | null> {
  const [row] = await tx.execute<{ price_minor: string | null }>(
    sql`SELECT coalesce(p.price_minor, s.price_minor)::text AS price_minor
        FROM clinic_services s
        LEFT JOIN service_provider_prices p
          ON p.clinic_id = s.clinic_id AND p.service_id = s.id AND p.member_id = ${memberId}
        WHERE s.clinic_id = ${clinicId} AND s.id = ${serviceId}`,
  );
  return row?.price_minor ?? null;
}
