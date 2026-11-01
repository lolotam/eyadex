import { reportExportSchema } from "@eyadex/contracts/finance-reports";

const idSchema = reportExportSchema.shape.id;
const EXTENSIONS = ["csv", "xlsx"] as const;

/** امتداد ملف التصدير. مفيش PDF ولا اسم ملف. */
export type ExportKeyExtension = (typeof EXTENSIONS)[number];

/**
 * مفتاح المحاولة: معرّفات فقط. أي id أو محاولة أو امتداد خارج العقد بيرجع `null`.
 *
 * @param input العيادة والتصدير ورقم المحاولة والامتداد
 * @returns المفتاح، أو `null` لو أي جزء مش آمن
 */
export function financeExportKey(input: {
  readonly clinicId: string;
  readonly exportId: string;
  readonly attempt: number;
  readonly extension: ExportKeyExtension;
}): string | null {
  const clinicId = idSchema.safeParse(input.clinicId);
  const exportId = idSchema.safeParse(input.exportId);
  if (!clinicId.success || !exportId.success) return null;
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > 5) return null;
  if (!EXTENSIONS.includes(input.extension)) return null;
  return `clinic/${clinicId.data.toLowerCase()}/finance-exports/${exportId.data.toLowerCase()}/${input.attempt}.${input.extension}`;
}
