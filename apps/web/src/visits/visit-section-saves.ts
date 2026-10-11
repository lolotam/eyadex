/** Saves what is typed and not saved yet; rejects when that save fails. */
export type NoteFlush = () => Promise<void>;

/** The parts of a draft saved on their own; Sign must never lock one of them mid-save. */
export type VisitSection = "note" | "diagnoses" | "prescription";

/** One key prefix for every section save of a visit, so `useIsMutating` counts them all for Sign. */
export const sectionSaveKey = (visitId: string, section?: VisitSection) =>
  section === undefined
    ? (["visit-section-save", visitId] as const)
    : (["visit-section-save", visitId, section] as const);

/**
 * The section saves running on one visit page (Codex PR #68): Sign waits for every one of them, so a
 * visit is never locked while a note, diagnoses or prescription save is still on its way.
 */
export class SectionSaves {
  private readonly running = new Set<Promise<unknown>>();
  private failures = 0;

  /** Follows one save until it settles; returns it unchanged. */
  track<T>(save: Promise<T>): Promise<T> {
    this.running.add(save);
    void save.then(
      () => this.running.delete(save),
      () => {
        this.running.delete(save);
        this.failures += 1;
      },
    );
    return save;
  }

  /**
   * Runs `flush` (text typed and not sent yet), then waits until no save runs, saves started meanwhile
   * included. Rejects when the flush or any save that settled in that time failed: signing then would
   * lock the visit without what the provider just saved.
   */
  async settle(flush: () => Promise<void>): Promise<void> {
    const failedBefore = this.failures;
    await flush();
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
    if (this.failures !== failedBefore) throw new Error("A visit section save failed.");
  }
}
