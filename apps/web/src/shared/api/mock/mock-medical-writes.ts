import { icd10Codes } from "./mock-icd10-list";
import {
  visitAddendumInputSchema,
  visitCancelSchema,
  visitDiagnosesInputSchema,
  visitNoteInputSchema,
  visitPrescriptionInputSchema,
} from "@eyadex/contracts/visits";
import { ApiError } from "../api-error";
import type { MedicalApi } from "../medical-client";
import { parse, writableVisit, type MedicalAccess } from "./mock-medical-access";
import { auditMedical, detailOf, isSignable } from "./mock-medical-project";
import type { StoredNote, StoredVisit } from "./mock-medical-state";
import { delay, getState, newId, persist, type MockState } from "./mock-store";

const NOTE_FIELDS = ["complaint", "examination", "assessment", "plan"] as const;
const filled = (text: string | null) => text !== null && text.trim().length > 0;
const empty = (text: string | null) => (filled(text) ? text : null);

/** The API's `sameList`: the same items in the same order, field by field. */
function sameList<T extends object>(before: readonly T[], after: readonly T[]): boolean {
  if (before.length !== after.length) return false;
  return before.every((item, i) => {
    const other = after[i] as Record<string, unknown>;
    return Object.entries(item).every(([key, value]) => other[key] === value);
  });
}

/**
 * An identical save writes nothing, but an answer with the content leaves the open's trail; one without
 * it (no `view:medical`) opens nothing (the API's `auditUnchangedWrite`).
 */
function answerUnchanged(db: MockState, a: MedicalAccess, v: StoredVisit) {
  const detail = detailOf(db, a, v);
  if (detail.content !== null) {
    auditMedical(db, a, "visit", "visit.opened", v.id, ["content"]);
    persist();
  }
  return detail;
}

/** Visit writes (P2-3, P2-6): draft only, the visit's provider only; a signed note never changes. */
export function createMockMedicalWrites(): Pick<
  MedicalApi,
  "saveNote" | "saveDiagnoses" | "savePrescription" | "signVisit" | "cancelVisit" | "addAddendum"
> {
  return {
    async saveNote(persona, visitId, rawInput) {
      await delay(120);
      const db = getState();
      const input = parse(visitNoteInputSchema, rawInput);
      const { a, v } = writableVisit(db, persona, visitId, "draft");
      const next: StoredNote = {
        complaint: empty(input.complaint),
        examination: empty(input.examination),
        assessment: empty(input.assessment),
        plan: empty(input.plan),
      };
      const changed = NOTE_FIELDS.filter((f) => next[f] !== v.note[f]);
      if (changed.length === 0) return answerUnchanged(db, a, v);
      v.note = next;
      auditMedical(db, a, "visit", "visit.note_saved", v.id, changed);
      persist();
      return detailOf(db, a, v);
    },

    async saveDiagnoses(persona, visitId, rawInput) {
      await delay();
      const db = getState();
      const input = parse(visitDiagnosesInputSchema, rawInput);
      const { a, v } = writableVisit(db, persona, visitId, "draft");
      for (const item of input.items) {
        if (item.kind === "icd10" && !icd10Codes.has(item.code))
          throw new ApiError("icd10_unknown");
      }
      const after = input.items.map((item) => ({
        kind: item.kind,
        code: item.kind === "icd10" ? item.code : null,
        text: item.text,
      }));
      const before = v.diagnoses
        .filter((d) => !d.archived)
        .map(({ kind, code, text }) => ({ kind, code, text }));
      if (sameList(before, after)) {
        return answerUnchanged(db, a, v);
      }
      // The whole list is replaced: earlier rows are archived, never deleted or shown again.
      for (const d of v.diagnoses) d.archived = true;
      after.forEach((item, position) => v.diagnoses.push({ ...item, position, archived: false }));
      auditMedical(db, a, "diagnosis", "visit.diagnoses_saved", v.id, ["items"]);
      persist();
      return detailOf(db, a, v);
    },

    async savePrescription(persona, visitId, rawInput) {
      await delay();
      const db = getState();
      const input = parse(visitPrescriptionInputSchema, rawInput);
      const { a, v } = writableVisit(db, persona, visitId, "draft");
      // A blank note is no note (the API's `sectionValue`), so it compares equal to a stored one.
      const after = input.items.map((item) => ({ ...item, note: empty(item.note) }));
      const before = v.prescription
        .filter((p) => !p.archived)
        .map(({ medicine, dose, frequency, duration, note }) => ({
          medicine,
          dose,
          frequency,
          duration,
          note,
        }));
      if (sameList(before, after)) {
        return answerUnchanged(db, a, v);
      }
      for (const p of v.prescription) p.archived = true;
      after.forEach((item, position) =>
        v.prescription.push({ ...item, position, archived: false }),
      );
      auditMedical(db, a, "prescription", "visit.prescription_saved", v.id, ["items"]);
      persist();
      return detailOf(db, a, v);
    },

    async signVisit(persona, visitId) {
      await delay();
      const db = getState();
      const { a, v } = writableVisit(db, persona, visitId, "draft");
      if (!isSignable(v)) throw new ApiError("visit_empty");
      v.status = "signed";
      v.signedAt = new Date().toISOString();
      auditMedical(db, a, "visit", "visit.signed", v.id, [], "signed");
      persist();
      return detailOf(db, a, v);
    },

    async cancelVisit(persona, visitId, rawInput) {
      await delay();
      const db = getState();
      const input = parse(visitCancelSchema, rawInput);
      const { a, v } = writableVisit(db, persona, visitId, "draft");
      v.status = "cancelled";
      v.cancelReason = input.reason;
      v.cancelNote = empty(input.note);
      // The reason is a fixed choice; the free note's text stays out of the row.
      auditMedical(db, a, "visit", "visit.cancelled", v.id, ["reason", "note"], "cancelled");
      persist();
      return detailOf(db, a, v);
    },

    async addAddendum(persona, visitId, rawInput) {
      await delay();
      const db = getState();
      const input = parse(visitAddendumInputSchema, rawInput);
      const { a, v } = writableVisit(db, persona, visitId, "signed");
      const addendum = {
        id: newId(),
        authorMembershipId: a.member.id,
        body: input.body,
        createdAt: new Date().toISOString(),
      };
      v.addenda.push(addendum);
      auditMedical(db, a, "visit_addendum", "visit.addendum_added", addendum.id, ["body"]);
      persist();
      return detailOf(db, a, v);
    },
  };
}
