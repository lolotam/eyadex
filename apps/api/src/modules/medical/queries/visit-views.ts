import type { VisitDetail, VisitSummary } from "@eyadex/contracts/visits";

import {
  EMPTY_NOTE,
  NOTE_SECTIONS,
  isSignable,
  medicalReach,
  medicalReachCovers,
  visitAbilities,
  type MedicalActor,
  type NoteText,
} from "../domain/visit-rules.ts";
import { addendaOf, notesOf, NOTE_COLUMN, type StoredNote } from "../persistence/pg-note-store.ts";
import type { VisitRow } from "../persistence/pg-visit-store.ts";
import type { ClinicalCipher } from "../ports/clinical-cipher.ts";
import type { ReadContext } from "../use-cases/medical-deps.ts";

const PREVIEW_LENGTH = 160;
// The FK makes a missing name impossible; the dash is the placeholder all the same.
const NO_NAME = "—";

const iso = (text: string): string => new Date(text).toISOString();

/**
 * Opens a stored note's four sections; each is bound to the note row's id (ADR-0028).
 *
 * @returns the plain sections, every one `null` without a note
 */
export function openNote(
  cipher: ClinicalCipher,
  clinicId: string,
  note: StoredNote | undefined,
): NoteText {
  if (note === undefined) return EMPTY_NOTE;
  const out: Record<string, string | null> = {};
  for (const section of NOTE_SECTIONS) {
    const envelope = note.sections[section];
    out[section] =
      envelope === null
        ? null
        : cipher.open(
            clinicId,
            { table: "visit_notes", column: NOTE_COLUMN[section], rowId: note.id },
            envelope,
          );
  }
  return out as NoteText;
}

/**
 * The list's preview: the assessment's first 160 characters (contract), only for a reader of the content.
 *
 * @returns the preview, or `null`
 */
export function previewOf(note: NoteText): string | null {
  return note.assessment === null ? null : note.assessment.slice(0, PREVIEW_LENGTH);
}

/**
 * A visit's metadata, what `view:visits:*` shows.
 *
 * @returns the summary
 */
export function visitSummary(
  visit: VisitRow,
  providerName: string,
  preview: string | null,
): VisitSummary {
  return {
    id: visit.id,
    patientId: visit.patientId,
    branchId: visit.branchId,
    providerMembershipId: visit.providerMembershipId,
    providerName,
    appointmentId: visit.appointmentId,
    status: visit.status,
    startedAt: iso(visit.startedAt),
    signedAt: visit.signedAt === null ? null : iso(visit.signedAt),
    preview,
  };
}

/**
 * Does the caller read this visit's clinical content? `view:medical:clinic`, or `own` on an own patient.
 *
 * @returns `true` when the content goes out
 */
export function readsContent(actor: MedicalActor, patientIsOwn: boolean): boolean {
  return medicalReachCovers(medicalReach(actor, "view"), patientIsOwn);
}

/**
 * The visit page (R3-2): metadata, the patient's name and file number, the branch names, and the content
 * only for a reader of it (P2-5, P2-K4). The caller already decided the visit is visible.
 *
 * @param reads the medical transaction and ports
 * @param actor the caller
 * @param visit the stored visit
 * @param patientIsOwn the patient is one of the caller's (`own`)
 * @returns the page
 */
export async function visitDetail(
  reads: ReadContext,
  actor: MedicalActor,
  visit: VisitRow,
  patientIsOwn: boolean,
): Promise<VisitDetail> {
  const { tx, cipher } = reads;
  const { clinicId } = actor;
  const stored = (await notesOf(tx, clinicId, [visit.id])).get(visit.id);
  const content = readsContent(actor, patientIsOwn);
  const addenda = content ? await addendaOf(tx, clinicId, [visit.id]) : [];
  const members = await reads.members.findMany(tx, clinicId, [
    visit.providerMembershipId,
    ...addenda.map((a) => a.authorMembershipId),
  ]);
  const patient = (await reads.patients.labels(tx, clinicId, [visit.patientId])).get(
    visit.patientId,
  );
  const branch = (await reads.branches.namesOf(tx, clinicId, [visit.branchId])).get(visit.branchId);
  const note = content ? openNote(cipher, clinicId, stored) : EMPTY_NOTE;
  // Empty sections are stored NULL (R1-8), so a stored envelope means content without opening it.
  const signable = isSignable(stored?.sections ?? EMPTY_NOTE, 0);
  const nameOf = (id: string) => members.get(id)?.fullName ?? NO_NAME;
  return {
    visit: visitSummary(
      visit,
      nameOf(visit.providerMembershipId),
      content ? previewOf(note) : null,
    ),
    patient: { fullName: patient?.fullName ?? NO_NAME, fileNumber: patient?.fileNumber ?? 0 },
    branch: { nameAr: branch?.nameAr ?? NO_NAME, nameEn: branch?.nameEn ?? NO_NAME },
    content: content
      ? {
          note,
          // Diagnoses, the prescription and attachments arrive with their own slices (0047–0049).
          diagnoses: [],
          prescription: [],
          addenda: addenda.map((a) => ({
            id: a.id,
            authorName: nameOf(a.authorMembershipId),
            body: cipher.open(
              clinicId,
              { table: "visit_addenda", column: "body_enc", rowId: a.id },
              a.bodyEnc,
            ),
            createdAt: iso(a.createdAt),
          })),
          attachments: [],
        }
      : null,
    can: visitAbilities(actor, visit, signable),
  };
}
