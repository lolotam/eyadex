/** العيادات اللي ممكن يكون عندها تذكيرات — على pool المنصة (`clinics` بس، مالوش grant على المواعيد). */
export interface ReminderClinicFinder {
  /**
   * العيادات اللي مش موقوفة ولسه اشتراكها شغّال، صفحة ورا صفحة بمؤشر.
   *
   * @param now الوقت من الـ Clock
   * @returns ids العيادات
   */
  activeClinics(now: Date): Promise<string[]>;
}

/** دفتر التذكيرات على pool العيادة (`eyadex_app`، `withTenant`). */
export interface ReminderQueue {
  /**
   * يفحص العيادة جوه سياقها: الموديول شغّال، والإعدادات سامحة بالتذكير؛ ثم يمشي على مواعيدها `booked`
   * اللي جوه نافذة تذكير، صفحة ورا صفحة، ويسجّل صف دفتر لكل تذكير مستحق (`ON CONFLICT DO NOTHING`)
   * والحدث بتاعه في نفس الـ transaction — للصفوف الجديدة بس.
   *
   * @param clinicId العيادة
   * @param now الوقت من الـ Clock، بيتقري مع كل صفحة
   * @returns عدد التذكيرات الجديدة
   */
  queue(clinicId: string, now: () => Date): Promise<number>;
}
