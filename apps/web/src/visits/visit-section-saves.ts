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
 * visit is never locked while a note, diagnoses or prescription save is still on its way, nor while a
 * section's last save failed and that section was not saved again since.
 */
export class SectionSaves {
  private readonly running = new Set<Promise<unknown>>();
  // A section's newest save decides its state: an older one settling late never hides or clears it.
  private readonly newest = new Map<VisitSection, Promise<unknown>>();
  private readonly failed = new Map<VisitSection, unknown>();

  /** Follows one save of `section` until it settles; returns it unchanged. */
  track<T>(section: VisitSection, save: Promise<T>): Promise<T> {
    this.running.add(save);
    this.newest.set(section, save);
    void save.then(
      () => {
        this.running.delete(save);
        if (this.newest.get(section) === save) this.failed.delete(section);
      },
      (error: unknown) => {
        this.running.delete(save);
        if (this.newest.get(section) === save) this.failed.set(section, error);
      },
    );
    return save;
  }

  /**
   * Runs `flush` (text typed and not sent yet), then waits until no save runs, saves started meanwhile
   * included. Rejects with the save's own error while a section's newest save failed, before the sign
   * or during it: signing then would lock the visit without what the provider meant to save.
   */
  async settle(flush: () => Promise<void>): Promise<void> {
    await flush();
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
    const [error] = this.failed.values();
    if (this.failed.size > 0) throw error;
  }
}
