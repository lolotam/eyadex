// PRD §4.11 lets the clinic admin read the whole log but names no permission that opens patient
// access rows to a custom role. TODO(spec): until it does, the conservative reading — the reader must
// also be allowed to see every patient of the clinic. The admin holds every key, so the PRD's case
// holds; a locked patients module removes the key (ADR-0010) and the rows with it.
const PATIENT_ACCESS_KEY = "view:patients:clinic";

/**
 * هل القارئ يشوف صفوف الوصول لملفات المراجعين في سجل عيادته؟
 *
 * @param permissions صلاحيات القارئ الفعلية (من غير مفاتيح الموديولات المقفولة)
 * @returns `true` لو معاه `view:patients:clinic`
 */
export function mayReadPatientAccess(permissions: readonly string[]): boolean {
  return permissions.includes(PATIENT_ACCESS_KEY);
}
