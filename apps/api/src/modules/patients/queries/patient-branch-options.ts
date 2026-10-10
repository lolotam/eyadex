import type { PatientBranchOptionList } from "@eyadex/contracts/patients-api";
import type { Database } from "@eyadex/db";

import { coversBranch, type MemberBranches, type PatientScope } from "../domain/patient-rules.ts";
import type { PatientBranchReader } from "../ports/patient-branch-reader.ts";

/**
 * الفروع اللي الفاعل يقدر يسجّل فيها أو يفلتر بيها لفعل واحد (story P6): فروع العيادة من port
 * المراجعين (tenancy بتنفّذه)، متصفّية بنطاق الفعل ده. الفروع المتعطلة بتفضل ظاهرة (الفلاتر وأسماء
 * الملفات القديمة محتاجاها)؛ الفورم بيقفلها، والكتابة بترفضها بـ `branch_inactive`. تحت `own` (عرض
 * بس، A3): الفروع النشطة لعضوية الفاعل (TODO(spec) 3 في ADR-0026 A3)، والفلتر بيضيّق جوه ملفاته بس.
 *
 * @param db الداتابيز (القراية جوه `withTenant`)
 * @param reader port فروع المراجعين
 * @param clinicId عيادة السياق
 * @param scope نطاق الفعل (الـ guard عدّاه، فمش null)
 * @param member فروع عضوية الفاعل النشطة (لنطاق `own`)
 * @param language لغة ترتيب الأسماء
 * @returns الفروع
 */
export async function patientBranchOptions(
  db: Database,
  reader: PatientBranchReader,
  clinicId: string,
  scope: PatientScope,
  member: MemberBranches,
  language: "ar" | "en",
): Promise<PatientBranchOptionList> {
  const branches = await db.withTenant(clinicId, (tx) =>
    reader.listForOptions(tx, clinicId, language),
  );
  const shown = (branch: { id: string; isActive: boolean }) =>
    "own" in scope
      ? branch.isActive && coversBranch(member, branch.id)
      : coversBranch(scope, branch.id);
  return branches.filter(shown).map((branch) => ({
    id: branch.id,
    nameAr: branch.nameAr,
    nameEn: branch.nameEn,
    isActive: branch.isActive,
  }));
}
