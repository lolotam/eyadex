import type { Invoice, InvoiceLineInput } from "@eyadex/contracts/finance";
import type { Totals } from "@eyadex/contracts/invoice-totals";
import { DatabaseError, type Tx } from "@eyadex/db";

import { ApiError } from "../../../shared/errors.ts";
import type { StoredLine } from "../persistence/pg-invoice-store.ts";
import { invoiceServiceFacts } from "../persistence/pg-invoice-services.ts";

type ServiceNames = ReadonlyMap<string, { nameAr: string; nameEn: string }>;

const discountKey = (discount: InvoiceLineInput["discount"]) =>
  discount === null
    ? null
    : [discount.kind, discount.kind === "pct" ? discount.bp : discount.minor, discount.reason];
const serviceKey = (
  line: Extract<InvoiceLineInput, { kind: "service" }> | Invoice["lines"][number],
) =>
  JSON.stringify([
    line.serviceId,
    line.providerId,
    line.quantity,
    line.unitPriceMinor,
    discountKey(line.discount),
  ]);

/**
 * دكتور السطر لازم يبقى عضو في العيادة. الموديول مبيقراش العضويات، فالمفتاح الأجنبي بتاع `invoice_lines`
 * هو اللي بيرفض الدكتور المجهول، والرفض ده بيرجع `validation` مش 500 (في الإصدار والتعديل).
 *
 * @param error الخطأ اللي طلع من الـ transaction
 * @returns مبيرجعش: بيرمي `validation` للمفتاح الأجنبي، وأي خطأ تاني زي ما هو
 */
export function unknownLineDoctor(error: unknown): never {
  if (error instanceof DatabaseError && error.code === "23503") {
    throw new ApiError("validation", [{ path: ["lines"], code: "unknownMember" }]);
  }
  throw error;
}

/**
 * سطور الخدمة الجديدة أو المتغيّرة لازم يبقى ليها سعر حالي (سعر الدكتور أو الأساسي)؛ المبلغ من الفورم.
 * السطر المحفوظ المطابق بيحتفظ بسعره حتى لو السعر الحالي اتمسح. خدمة مش موجودة = `validation`،
 * وسطر محتاج سعر ومفيش سعر = `price_missing`.
 *
 * @param tx الـ transaction جوه `withTenant(clinicId)`
 * @param clinicId العيادة
 * @param lines السطور بترتيبها
 * @param previous سطور الفاتورة قبل التعديل؛ كل سطر محفوظ يعفي نسخة واحدة مطابقة من السعر الحالي
 * @returns أسماء الخدمات اللي سطورها هتنسخها
 */
export async function checkServiceLines(
  tx: Tx,
  clinicId: string,
  lines: readonly InvoiceLineInput[],
  previous: readonly Invoice["lines"][number][] = [],
): Promise<ServiceNames> {
  const serviceLines = lines.flatMap((line, position) =>
    line.kind === "service" ? [{ line, position }] : [],
  );
  const facts = await invoiceServiceFacts(
    tx,
    clinicId,
    serviceLines.map(({ line }) => line.serviceId),
  );
  const unchanged = new Map<string, Invoice["lines"][number][]>();
  for (const line of previous) {
    if (line.kind !== "service") continue;
    const key = serviceKey(line);
    unchanged.set(key, [...(unchanged.get(key) ?? []), line]);
  }
  const names = new Map<string, { nameAr: string; nameEn: string }>();
  for (const { line, position } of serviceLines) {
    const old = unchanged.get(serviceKey(line))?.shift();
    const fact = facts.get(line.serviceId);
    if (fact === undefined) {
      throw new ApiError("validation", [
        { path: ["lines", position, "serviceId"], code: "unknown" },
      ]);
    }
    const price =
      line.providerId === null
        ? fact.priceMinor
        : (fact.providerPrices.get(line.providerId) ?? fact.priceMinor);
    if (old === undefined && price === null) {
      throw new ApiError("price_missing", { position });
    }
    names.set(line.serviceId, fact);
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
