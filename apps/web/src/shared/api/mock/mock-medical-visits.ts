import {
  visitListQuerySchema,
  visitSearchSchema,
  visitStartSchema,
} from "@eyadex/contracts/visits";
import type { Persona } from "@eyadex/contracts/session";
import { matches } from "../../text/text-match";
import { ApiError } from "../api-error";
import type { MedicalApi } from "../medical-client";
import { actorReplayKey, requireIdempotencyKey } from "./mock-idempotency";
import {
  guardMedical,
  isOwnMedicalPatient,
  parse,
  patientOf,
  reachesContent,
  requireKey,
  seesVisit,
  visibleVisit,
  type MedicalAccess,
} from "./mock-medical-access";
import { auditMedical, detailOf } from "./mock-medical-project";
import { requireOpenBranch, worksIn } from "./mock-medical-walk-in";
import { newestFirst, SEARCH_SCAN_LIMIT, visitPage } from "./mock-visit-page";
import type { StoredVisit } from "./mock-medical-state";
import { delay, getState, newId, persist, type MockState } from "./mock-store";

/**
 * What the API's `searchVisitPage` matches a query against, in its order: the note sections, the
 * addenda, then each active diagnosis's code and text, joined, so the words of a query may come from
 * different parts of one visit.
 */
function searchedText(v: StoredVisit): string {
  const diagnosed = v.diagnoses.filter((d) => !d.archived).flatMap((d) => [d.code, d.text]);
  return [...Object.values(v.note), ...v.addenda.map((x) => x.body), ...diagnosed]
    .filter((text) => text !== null)
    .join("\n");
}

/**
 * The visits a search scans, as the API's `visitViewReach`: the widest visits key wins, and only
 * `branch` narrows (`clinic`, `own` and no visits key at all scan every visit of a file whose content
 * the caller reads).
 */
function searchScans(a: MedicalAccess, v: StoredVisit): boolean {
  if (a.keys.includes("view:visits:clinic") || !a.keys.includes("view:visits:branch")) return true;
  return a.branches.allBranches || a.branches.branchIds.includes(v.branchId);
}

function fingerprint(input: unknown): string {
  return JSON.stringify(input);
}

function startFrom(
  db: MockState,
  a: MedicalAccess,
  input: ReturnType<typeof visitStartSchema.parse>,
) {
  if ("appointmentId" in input) {
    const appt = db.appointments.find(
      (x) => x.clinicId === a.clinic.id && x.id === input.appointmentId,
    );
    if (!appt) throw new ApiError("not_found");
    // create:visits:own: the caller starts a visit only as its provider.
    if (appt.providerMembershipId !== a.member.id) throw new ApiError("forbidden");
    if (appt.status !== "arrived") throw new ApiError("appointment_not_arrived");
    const live = db.medical.visits.find(
      (v) => v.appointmentId === appt.id && v.status !== "cancelled",
    );
    if (live) throw new ApiError("visit_exists", undefined, { visitId: live.id });
    // In the API's order (start-visit.ts): an archived file or a closed branch takes no new visit, even
    // from an appointment booked before it was archived or closed (Codex PR #68).
    const patient = patientOf(db, a, appt.patientId);
    if (patient.status !== "active") throw new ApiError("patient_inactive");
    requireOpenBranch(db, a, appt.branchId);
    return { patientId: appt.patientId, branchId: appt.branchId, appointmentId: appt.id };
  }
  if (!worksIn(a, input.branchId)) throw new ApiError("forbidden");
  const patient = patientOf(db, a, input.patientId);
  // As the API (walk-in reach) and the candidate search: a walk-in starts only for a file registered in
  // that branch, so a crafted start cannot make another branch's patient "own" (Codex P2 PR #68). The
  // reach is judged before the file's status, so another branch's archived file stays `not_found`.
  if (patient.registrationBranchId !== input.branchId) throw new ApiError("not_found");
  if (patient.status !== "active") throw new ApiError("patient_inactive");
  requireOpenBranch(db, a, input.branchId);
  return { patientId: patient.id, branchId: input.branchId, appointmentId: null };
}

export function createMockMedicalVisits(): Pick<
  MedicalApi,
  "listVisits" | "searchVisits" | "startVisit" | "getVisit"
> {
  return {
    async listVisits(persona: Persona, patientId, rawQuery) {
      await delay();
      const db = getState();
      const a = requireKey(db, persona, "view", "visits", ["clinic", "branch", "own"]);
      const query = parse(visitListQuerySchema, rawQuery);
      const patient = patientOf(db, a, patientId);
      // As the API's `visitViewReach`: an `own` reader is told nothing of a file that is not its own.
      const ownOnly = !["clinic", "branch"].some((s) => a.keys.includes(`view:visits:${s}`));
      if (ownOnly && !isOwnMedicalPatient(db, a, patientId)) throw new ApiError("not_found");
      const rows = db.medical.visits
        .filter((v) => v.clinicId === a.clinic.id && v.patientId === patientId)
        .filter((v) => seesVisit(db, a, v))
        .sort(newestFirst);
      const result = visitPage(db, a, rows, query.cursor, patient);
      if (result.items.some((i) => i.preview !== null)) {
        auditMedical(db, a, "patient", "visit.previews_listed", patientId);
        persist();
      }
      return result;
    },

    async searchVisits(persona, patientId, rawQuery) {
      await delay();
      const db = getState();
      const a = requireKey(db, persona, "view", "medical", ["clinic", "own"]);
      const query = parse(visitSearchSchema, rawQuery);
      const patient = patientOf(db, a, patientId);
      if (!reachesContent(db, a, "view", patientId)) throw new ApiError("not_found");
      // As the API: only the patient's 500 newest visits in reach are scanned (P2-F4).
      const rows = db.medical.visits
        .filter((v) => v.clinicId === a.clinic.id && v.patientId === patientId)
        .filter((v) => searchScans(a, v))
        .sort(newestFirst)
        .slice(0, SEARCH_SCAN_LIMIT)
        .filter((v) => matches(searchedText(v), query.q));
      // Read first: a malformed cursor answers before anything is audited, as the API's transaction.
      const result = visitPage(db, a, rows, query.cursor, patient);
      // The query itself never reaches the audit row (P2-F4).
      auditMedical(db, a, "patient", "visit.searched", patientId);
      persist();
      return result;
    },

    async startVisit(persona, rawInput, idempotencyKey) {
      await delay();
      const db = getState();
      // The API's order: the guard, the body, then the key (`keyOf`).
      const a = requireKey(db, persona, "create", "visits", ["own"]);
      const input = parse(visitStartSchema, rawInput);
      const key = requireIdempotencyKey(idempotencyKey);
      const replayKey = actorReplayKey(a.clinic.id, a.member.id, key);
      const previous = db.medical.idempotentVisits[replayKey];
      if (previous) {
        if (previous.fingerprint !== fingerprint(input)) throw new ApiError("idempotency_conflict");
        const replayed = db.medical.visits.find((v) => v.id === previous.visitId);
        if (replayed) {
          // A replay answers the visit's current note, so it is logged as an open, like getVisit.
          const detail = detailOf(db, a, replayed);
          if (detail.content) {
            auditMedical(db, a, "visit", "visit.opened", replayed.id);
            persist();
          }
          return detail;
        }
      }
      const target = startFrom(db, a, input);
      const visit: StoredVisit = {
        id: newId(),
        clinicId: a.clinic.id,
        ...target,
        providerMembershipId: a.member.id,
        status: "draft",
        startedAt: new Date().toISOString(),
        signedAt: null,
        cancelReason: null,
        cancelNote: null,
        note: { complaint: null, examination: null, assessment: null, plan: null },
        diagnoses: [],
        prescription: [],
        addenda: [],
      };
      db.medical.visits.push(visit);
      db.medical.idempotentVisits[replayKey] = {
        visitId: visit.id,
        fingerprint: fingerprint(input),
      };
      auditMedical(db, a, "visit", "visit.started", visit.id, ["status"]);
      persist();
      return detailOf(db, a, visit);
    },

    async getVisit(persona, visitId) {
      await delay();
      const db = getState();
      const a = guardMedical(db, persona);
      if (!["clinic", "branch", "own"].some((s) => a.keys.includes(`view:visits:${s}`))) {
        throw new ApiError("forbidden");
      }
      const v = visibleVisit(db, a, visitId);
      const detail = detailOf(db, a, v);
      // Only an answer with the clinical content is a patient-file open (as the API and the replay).
      if (detail.content !== null) {
        auditMedical(db, a, "visit", "visit.opened", v.id);
        persist();
      }
      return detail;
    },
  };
}
