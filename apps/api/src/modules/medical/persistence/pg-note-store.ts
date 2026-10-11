import type { Tx } from "@eyadex/db";
import { sql } from "drizzle-orm";

import type { NoteSection } from "../domain/visit-rules.ts";

/** الملاحظة زي ما اتخزّنت: معرّف صفها (اللي التشفير مربوط بيه) وظرف لكل قسم أو `null`. */
export interface StoredNote {
  readonly id: string;
  readonly sections: Readonly<Record<NoteSection, string | null>>;
}

interface RawNote {
  id: string;
  visit_id: string;
  complaint_enc: string | null;
  examination_enc: string | null;
  assessment_enc: string | null;
  plan_enc: string | null;
}

const toNote = (r: RawNote): StoredNote => ({
  id: r.id,
  sections: {
    complaint: r.complaint_enc,
    examination: r.examination_enc,
    assessment: r.assessment_enc,
    plan: r.plan_enc,
  },
});

/** The column each note section is sealed into (and bound to, ADR-0028). */
export const NOTE_COLUMN: Readonly<Record<NoteSection, string>> = {
  complaint: "complaint_enc",
  examination: "examination_enc",
  assessment: "assessment_enc",
  plan: "plan_enc",
};

/**
 * The notes of several visits in one statement (a list's previews, a search).
 *
 * @returns each visit's stored note by visit id
 */
export async function notesOf(
  tx: Tx,
  clinicId: string,
  visitIds: readonly string[],
): Promise<ReadonlyMap<string, StoredNote>> {
  if (visitIds.length === 0) return new Map();
  const rows = await tx.execute<RawNote>(
    sql`SELECT id, visit_id, complaint_enc, examination_enc, assessment_enc, plan_enc
        FROM visit_notes WHERE clinic_id = ${clinicId}
          AND visit_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify([...visitIds])}::jsonb))`,
  );
  return new Map(rows.map((r) => [r.visit_id, toNote(r)]));
}

/** A note write: who saves it, when. */
export interface NoteWrite {
  readonly note: {
    readonly id: string;
    readonly visitId: string;
    readonly sections: StoredNote["sections"];
  };
  readonly updatedBy: string;
  readonly now: Date;
}

/**
 * A visit's first note save. The caller holds the visit row `FOR UPDATE`, so no other save of the same
 * note runs in between; the row id it inserts is the one the envelopes are bound to.
 */
export async function insertNote(tx: Tx, clinicId: string, write: NoteWrite): Promise<void> {
  const { note, updatedBy } = write;
  const at = write.now.toISOString();
  const s = note.sections;
  await tx.execute(
    sql`INSERT INTO visit_notes (clinic_id, id, visit_id, complaint_enc, examination_enc,
          assessment_enc, plan_enc, updated_by, created_at, updated_at)
        VALUES (${clinicId}, ${note.id}, ${note.visitId}, ${s.complaint}, ${s.examination},
          ${s.assessment}, ${s.plan}, ${updatedBy}, ${at}::timestamptz, ${at}::timestamptz)`,
  );
}

/** A later note save, by the note row's id (never an upsert: an envelope stays bound to its row). */
export async function updateNote(tx: Tx, clinicId: string, write: NoteWrite): Promise<void> {
  const s = write.note.sections;
  await tx.execute(
    sql`UPDATE visit_notes SET complaint_enc = ${s.complaint}, examination_enc = ${s.examination},
          assessment_enc = ${s.assessment}, plan_enc = ${s.plan}, updated_by = ${write.updatedBy},
          updated_at = ${write.now.toISOString()}::timestamptz
        WHERE clinic_id = ${clinicId} AND id = ${write.note.id}`,
  );
}

/** An addendum as stored: its author and sealed body. */
export interface StoredAddendum {
  readonly id: string;
  readonly visitId: string;
  readonly authorMembershipId: string;
  readonly bodyEnc: string;
  readonly createdAt: string;
}

/**
 * The addenda of several visits, oldest first.
 *
 * @returns every addendum of those visits
 */
export async function addendaOf(
  tx: Tx,
  clinicId: string,
  visitIds: readonly string[],
): Promise<readonly StoredAddendum[]> {
  if (visitIds.length === 0) return [];
  const rows = await tx.execute<{
    id: string;
    visit_id: string;
    author_membership_id: string;
    body_enc: string;
    created_at: string;
  }>(
    sql`SELECT id, visit_id, author_membership_id, body_enc,
          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
        FROM visit_addenda WHERE clinic_id = ${clinicId}
          AND visit_id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify([...visitIds])}::jsonb))
        ORDER BY created_at, id`,
  );
  return rows.map((r) => ({
    id: r.id,
    visitId: r.visit_id,
    authorMembershipId: r.author_membership_id,
    bodyEnc: r.body_enc,
    createdAt: r.created_at,
  }));
}

export async function insertAddendum(
  tx: Tx,
  clinicId: string,
  addendum: { readonly id: string; readonly visitId: string; readonly bodyEnc: string },
  authorMembershipId: string,
  now: Date,
): Promise<void> {
  await tx.execute(
    sql`INSERT INTO visit_addenda (clinic_id, id, visit_id, author_membership_id, body_enc, created_at)
        VALUES (${clinicId}, ${addendum.id}, ${addendum.visitId}, ${authorMembershipId},
          ${addendum.bodyEnc}, ${now.toISOString()}::timestamptz)`,
  );
}
