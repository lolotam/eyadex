import type { InvoiceLineInput } from "@eyadex/contracts/finance";
import type { Totals } from "@eyadex/contracts/invoice-totals";
import type { Tx } from "@eyadex/db";

import { ApiError } from "../../../shared/errors.ts";
import { serviceNames, type StoredLine } from "../persistence/pg-invoice-store.ts";
import { effectivePrice } from "../persistence/pg-price-store.ts";

type ServiceNames = Awaited<ReturnType<typeof serviceNames>>;

/**
 * سطور الخدمة لازم تبقى لخدمة في العيادة ليها سعر (سعر الدكتور أو الأساسي)؛ المبلغ نفسه من الفورم، ممكن
 * يكون اتعدّل. خدمة مش موجودة = `validation`، من غير سعر = `price_missing`.
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param clinicId العيادة
 * @param lines السطور بترتيبها
 * @returns أسماء الخدمات اللي سطورها هتنسخها
 */
export async function checkServiceLines(
  tx: Tx,
  clinicId: string,
  lines: readonly InvoiceLineInput[],
): Promise<ServiceNames> {
  const serviceLines = lines.flatMap((line, position) =>
    line.kind === "service" ? [{ line, position }] : [],
  );
  const names = await serviceNames(
    tx,
    clinicId,
    serviceLines.map(({ line }) => line.serviceId),
  );
  for (const { line, position } of serviceLines) {
    if (!names.has(line.serviceId)) {
      throw new ApiError("validation", [
        { path: ["lines", position, "serviceId"], code: "unknown" },
      ]);
    }
    if ((await effectivePrice(tx, clinicId, line.serviceId, line.providerId)) === null) {
      throw new ApiError("price_missing", { position });
    }
  }
  return names;
}

/**
 * السطور زي ما هتتكتب: الترتيب هو مكانها في الطلب، وسطر الخدمة بياخد اسم الخدمة، والمبلغ من الإجماليات.
 *
 * @param ids مولّد الـ ids
 * @param lines السطور بترتيبها
 * @param names أسماء الخدمات من `checkServiceLines`
 * @param totals الإجماليات من `invoiceTotals`
 * @returns السطور الجاهزة للحفظ
 */
export function storedLines(
  ids: { newId(): string },
  lines: readonly InvoiceLineInput[],
  names: ServiceNames,
  totals: Totals,
): StoredLine[] {
  return lines.map((line, position) => {
    const lineTotalMinor = totals.lines[position]!.lineTotalMinor.toString();
    const common = {
      id: ids.newId(),
      position,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      discount: line.discount,
      lineTotalMinor,
    };
    if (line.kind === "free") {
      return {
        ...common,
        kind: "free",
        serviceId: null,
        providerId: null,
        descriptionAr: line.descriptionAr,
        descriptionEn: line.descriptionEn,
      };
    }
    const name = names.get(line.serviceId)!;
    return {
      ...common,
      kind: "service",
      serviceId: line.serviceId,
      providerId: line.providerId,
      descriptionAr: name.nameAr,
      descriptionEn: name.nameEn,
    };
  });
}
