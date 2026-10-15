import type { PlatformClinicFinance, platformFinanceTotalsSchema } from "@eyadex/contracts/finance";
import type { CurrencyCode } from "@eyadex/contracts/money";
import type { Database } from "@eyadex/db";
import { sql } from "drizzle-orm";
import type { z } from "zod";

/**
 * عملة العيادة وخاناتها ونسبة ضريبتها، على pool المنصة.
 *
 * @param db pool الـ `eyadex_platform`
 * @param clinicId العيادة
 * @returns القيم، أو `null` لو العيادة مش موجودة
 */
export function readPlatformClinicFinance(
  db: Database,
  clinicId: string,
): Promise<PlatformClinicFinance | null> {
  return db.withTenant(clinicId, async (tx) => {
    const [row] = await tx.execute<{
      currency: CurrencyCode;
      currency_exponent: number;
      tax_rate_bp: number;
    }>(sql`SELECT currency, currency_exponent, tax_rate_bp FROM clinics WHERE id = ${clinicId}`);
    return row === undefined
      ? null
      : {
          currency: row.currency,
          currencyExponent: row.currency_exponent,
          taxRateBp: row.tax_rate_bp,
        };
  });
}

/**
 * إجمالي الفواتير غير الملغية لكل شهر بتوقيت العيادة (FIN-3)، من `finance_monthly_totals` (0061): المنصة
 * مالهاش أي صلاحية على صفوف الفواتير، فالدالة هي الطريق الوحيد.
 *
 * @param db pool الـ `eyadex_platform`
 * @param clinicId العيادة
 * @returns الشهور، الأقدم الأول
 */
export function readPlatformFinanceTotals(
  db: Database,
  clinicId: string,
): Promise<z.infer<typeof platformFinanceTotalsSchema>> {
  return db.withTenant(clinicId, async (tx) => {
    const rows = await tx.execute<{ month: string; currency: CurrencyCode; invoiced: string }>(
      sql`SELECT to_char(month, 'YYYY-MM') AS month, currency, invoiced_minor::text AS invoiced
          FROM finance_monthly_totals(${clinicId}::uuid) ORDER BY month`,
    );
    return {
      months: rows.map((r) => ({
        month: r.month,
        currency: r.currency,
        invoicedMinor: r.invoiced,
      })),
    };
  });
}
