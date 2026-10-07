/** ما يلزم لإلغاء دعوات العيادة اللي مابقالهاش فرع نشط. */
export interface OrphanCancelRequest {
  readonly clinicId: string;
  /** الفرع اللي اتعطّل: الإلغاء بيشمل بس الدعوات اللي عليه، واللي مابقالهاش أي فرع نشط. */
  readonly branchId: string;
  /** وقت التعطيل: لو الفرع اتفعّل بعده، الحدث ده قديم وتعطيل أحدث ليه حدثه هو. */
  readonly deactivatedAt: Date;
  readonly eventId: string;
  /** الأدمن اللي عطّل الفرع: الفاعل في صف السجل. */
  readonly actorUserId: string;
}

/** الإلغاء التلقائي في transaction واحدة تحت عيادة الحدث. */
export interface OrphanInvitationCanceller {
  /**
   * يلغي كل دعوة معلّقة على الفرع ده مابقالهاش فرع نشط، يحرّر إيميلها ويكتب صف سجل لكل واحدة، بترتيب
   * الأقفال users → صفوف الدعوات → branches، والوقت بيتقرا بعد آخر قفل. حدث اتفعّل فرعه بعده
   * مابيلغيش حاجة، عشان السجل مايسجّلش إلغاء باسم أدمن تعطيله اتلغى.
   *
   * @param request العيادة والحدث والفاعل
   * @param now الساعة؛ بتتقرا مرة واحدة بعد الأقفال
   * @returns عدد الدعوات اللي اتلغت (0 في الإعادة)
   */
  cancelOrphaned(request: OrphanCancelRequest, now: () => Date): Promise<number>;
}
