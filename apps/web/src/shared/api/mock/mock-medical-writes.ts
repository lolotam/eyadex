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
import { parse, writableVisit } from "./mock-medical-access";
import { auditMedical, detailOf, isSignable } from "./mock-medical-project";
import type { StoredNote } from "./mock-medical-state";
import { delay, getState, newId, persist } from "./mock-store";

const NOTE_FIELDS = ["complaint", "examination", "assessment", "plan"] as const;
const filled = (text: string | null) => text !== null && text.trim().length > 0;
const empty = (text: string | null) => (filled(text) ? text : null);

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
      v.note = next;
      // An identical save still answers the note, so it leaves the open's trail (as the API does).
      if (changed.length > 0) auditMedical(db, a, "visit", "visit.note_saved", v.id, changed);
      else auditMedical(db, a, "visit", "visit.opened", v.id, ["content"]);
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
      // The whole list is replaced: earlier rows are archived, never deleted or shown again.
      for (const d of v.diagnoses) d.archived = true;
      input.items.forEach((item, position) =>
        v.diagnoses.push({
          position,
          kind: item.kind,
          code: item.kind === "icd10" ? item.code : null,
          text: item.text,
          archived: false,
        }),
      );
      auditMedical(db, a, "diagnosis", "visit.diagnoses_saved", v.id, ["items"]);
      persist();
      return detailOf(db, a, v);
    },

    async savePrescription(persona, visitId, rawInput) {
      await delay();
      const db = getState();
      const input = parse(visitPrescriptionInputSchema, rawInput);
      const { a, v } = writableVisit(db, persona, visitId, "draft");
      for (const p of v.prescription) p.archived = true;
      input.items.forEach((item, position) =>
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
      v.cancelNote = input.note;
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
