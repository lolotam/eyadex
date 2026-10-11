/** Saves what is typed and not saved yet; rejects when that save fails. */
export type NoteFlush = () => Promise<void>;

/** The parts of a draft saved on their own; Sign must never lock one of them mid-save. */
export type VisitSection = "note" | "diagnoses" | "prescription";

/** A list section holding edits that do not pass its own validation: Sign and Cancel refuse. */
export class SectionInvalidError extends Error {
  constructor(readonly section: "diagnoses" | "prescription") {
    super(`${section} has edits that do not validate`);
    this.name = "SectionInvalidError";
  }
}

/** One key prefix for every section save of a visit, so `useIsMutating` counts them all for Sign. */
export const sectionSaveKey = (visitId: string, section?: VisitSection) =>
  section === undefined
    ? (["visit-section-save", visitId] as const)
    : (["visit-section-save", visitId, section] as const);

/**
 * The section saves running on one visit page (Codex PR #68): Sign waits for every one of them, so a
 * visit is never locked while a note, diagnoses or prescription save is still on its way, nor while a
 * section's last save failed and that section was not saved again since. A list form registers its
 * flush (Codex 4241757315), so edits made after its last save are saved before the visit locks.
 */
export class SectionSaves {
  private readonly running = new Set<Promise<unknown>>();
  // A section's newest save decides its state: an older one settling late never hides or clears it.
  private readonly newest = new Map<VisitSection, Promise<unknown>>();
  private readonly failed = new Map<VisitSection, unknown>();
  private readonly flushes = new Map<VisitSection, () => Promise<void>>();

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

  /** A section form's flush (its unsaved edits, through its own validated save); returns the undo. */
  register(section: VisitSection, flush: () => Promise<void>): () => void {
    this.flushes.set(section, flush);
    return () => {
      if (this.flushes.get(section) === flush) this.flushes.delete(section);
    };
  }

  /**
   * Waits for the saves on their way (a list then compares with what the server holds), runs `flush`
   * (the note's text not sent yet) and every registered section flush, then waits until no save runs,
   * saves started meanwhile included. Rejects with a flush's or a save's own error while a section's
   * newest save failed: signing then would lock the visit without what the provider meant to save.
   */
  async settle(flush: () => Promise<void>): Promise<void> {
    await this.idle();
    await flush();
    for (const sectionFlush of this.flushes.values()) await sectionFlush();
    await this.idle();
    const [error] = this.failed.values();
    if (this.failed.size > 0) throw error;
  }

  private async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running]);
  }
}
