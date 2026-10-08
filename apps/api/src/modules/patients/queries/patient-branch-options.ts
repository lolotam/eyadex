import type { PatientBranchOptionList } from "@eyadex/contracts/patients-api";

import type { BranchReader } from "../../tenancy/index.ts";
import { coversBranch, type PatientScope } from "../domain/patient-rules.ts";

/**
 * الفروع اللي الفاعل يقدر يسجّل فيها أو يفلتر بيها لفعل واحد (story P6): فروع العيادة من الـ port
 * بتاع tenancy، متصفّية بنطاق الفعل ده. الفروع المتعطلة بتفضل ظاهرة (الفلاتر وأسماء الملفات القديمة
 * محتاجاها)؛ الفورم بيقفلها، والكتابة بترفضها بـ `branch_inactive`.
 *
 * @param reader قارئ فروع tenancy
 * @param clinicId عيادة السياق
 * @param scope نطاق الفعل (الـ guard عدّاه، فمش null)
 * @param language لغة ترتيب الأسماء
 * @returns الفروع
 */
export async function patientBranchOptions(
  reader: BranchReader,
  clinicId: string,
  scope: PatientScope,
  language: "ar" | "en",
): Promise<PatientBranchOptionList> {
  const branches = await reader.listBranches(clinicId, language);
  return branches
    .filter((branch) => coversBranch(scope, branch.id))
    .map((branch) => ({
      id: branch.id,
      nameAr: branch.nameAr,
      nameEn: branch.nameEn,
      isActive: branch.isActive,
    }));
}
