import type { PatientBranchOptionList } from "@eyadex/contracts/patients-api";
import type { Database } from "@eyadex/db";

import { coversBranch, type PatientScope } from "../domain/patient-rules.ts";
import type { PatientBranchReader } from "../ports/patient-branch-reader.ts";

/**
 * الفروع اللي الفاعل يقدر يسجّل فيها أو يفلتر بيها لفعل واحد (story P6): فروع العيادة من port
 * المراجعين (tenancy بتنفّذه)، متصفّية بنطاق الفعل ده. الفروع المتعطلة بتفضل ظاهرة (الفلاتر وأسماء
 * الملفات القديمة محتاجاها)؛ الفورم بيقفلها، والكتابة بترفضها بـ `branch_inactive`.
 *
 * @param db الداتابيز (القراية جوه `withTenant`)
 * @param reader port فروع المراجعين
 * @param clinicId عيادة السياق
 * @param scope نطاق الفعل (الـ guard عدّاه، فمش null)
 * @param language لغة ترتيب الأسماء
 * @returns الفروع
 */
export async function patientBranchOptions(
  db: Database,
  reader: PatientBranchReader,
  clinicId: string,
  scope: PatientScope,
  language: "ar" | "en",
): Promise<PatientBranchOptionList> {
  const branches = await db.withTenant(clinicId, (tx) =>
    reader.listForOptions(tx, clinicId, language),
  );
  return branches
    .filter((branch) => coversBranch(scope, branch.id))
    .map((branch) => ({
      id: branch.id,
      nameAr: branch.nameAr,
      nameEn: branch.nameEn,
      isActive: branch.isActive,
    }));
}
