/** ما يلزم لإلغاء دعوات العيادة اللي مابقالهاش فرع نشط. */
export interface OrphanCancelRequest {
  readonly clinicId: string;
  /** للسجل بس: القاعدة "مفيش فرع نشط"، مش "الفرع ده". */
  readonly branchId: string;
  readonly eventId: string;
  /** الأدمن اللي عطّل الفرع: الفاعل في صف السجل. */
  readonly actorUserId: string;
}

/** الإلغاء التلقائي في transaction واحدة تحت عيادة الحدث. */
export interface OrphanInvitationCanceller {
  /**
   * يلغي كل دعوة معلّقة في العيادة مابقالهاش فرع نشط، يحرّر إيميلها ويكتب صف سجل لكل واحدة، بترتيب
   * الأقفال users → صفوف الدعوات → branches، والوقت بيتقرا بعد آخر قفل.
   *
   * @param request العيادة والحدث والفاعل
   * @param now الساعة؛ بتتقرا مرة واحدة بعد الأقفال
   * @returns عدد الدعوات اللي اتلغت (0 في الإعادة)
   */
  cancelOrphaned(request: OrphanCancelRequest, now: () => Date): Promise<number>;
}
