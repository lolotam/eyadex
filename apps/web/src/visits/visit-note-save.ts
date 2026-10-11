/** Saves what is typed and not saved yet; rejects when that save fails. */
export type NoteFlush = () => Promise<void>;

/** The note saves of one visit, so its Sign button can wait for them (`useIsMutating`). */
export const noteSaveKey = (visitId: string) => ["visit-note-save", visitId] as const;
