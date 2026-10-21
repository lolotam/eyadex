import type { InvoiceSettlement } from "@eyadex/contracts/finance";
import { invoiceSettlement, type PatientMoney } from "@eyadex/contracts/settlement";

/**
 * حالة الفاتورة كما تشتقها الدالة المشتركة: الـ API بيجاوب بالحالة اللي الدالة المشتركة بتستنتجها من
 * الحركات، مش بقاعدة من عنده (spec §4.3) — فبقى الـ API والـ mock والإيصال كلهم بيقولوا نفس الكلام.
 *
 * @param money حركات المراجع
 * @param invoice الفاتورة: هويتها وحالتها وإجماليها
 * @returns حالة الفاتورة ومبالغها كنص، أو `null` لو الفاتورة ملغاة (والملغاة مالها حالة)
 */
export function settlementView(
  money: PatientMoney,
  invoice: {
    readonly id: string;
    readonly status: "issued" | "void";
    readonly totalMinor: string;
  },
): InvoiceSettlement | null {
  const summary = invoiceSettlement(money, {
    id: invoice.id,
    status: invoice.status,
    totalMinor: BigInt(invoice.totalMinor),
  });
  if (summary === null) return null;
  return {
    state: summary.state,
    paidMinor: String(summary.paidMinor),
    owedMinor: String(summary.owedMinor),
  };
}
