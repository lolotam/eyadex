import {
  visitListQuerySchema,
  visitSearchSchema,
  visitStartSchema,
  walkInSearchSchema,
  type VisitList,
} from "@eyadex/contracts/visits";
import type { Persona } from "@eyadex/contracts/session";
import { ApiError } from "../api-error";
import type { MedicalApi } from "../medical-client";
import { actorReplayKey } from "./mock-idempotency";
import {
  guardMedical,
  parse,
  patientOf,
  reachesContent,
  requireKey,
  seesVisit,
  visibleVisit,
  type MedicalAccess,
} from "./mock-medical-access";
import { auditMedical, detailOf, summaryOf } from "./mock-medical-project";
import type { StoredVisit } from "./mock-medical-state";
import { delay, getState, newId, persist, type MockState } from "./mock-store";

const PAGE = 20;

const newestFirst = (x: StoredVisit, y: StoredVisit) =>
  y.startedAt.localeCompare(x.startedAt) || y.id.localeCompare(x.id);

function page(
  db: MockState,
  a: MedicalAccess,
  rows: StoredVisit[],
  cursor: string | undefined,
  patientId: string,
): VisitList {
  const start = cursor ? Number(cursor) || 0 : 0;
  const slice = rows.slice(start, start + PAGE);
  return {
    items: slice.map((v) => summaryOf(db, a, v)),
    nextCursor: start + PAGE < rows.length ? String(start + PAGE) : null,
    can: {
      search: reachesContent(db, a, "view", patientId),
      start: a.keys.includes("create:visits:own"),
    },
  };
}

/** The active branches where the caller may start a walk-in: its own branch scope (R3). */
function walkInBranchList(db: MockState, a: MedicalAccess) {
  return db.branches
    .filter(
      (b) =>
        b.clinicId === a.clinic.id &&
        b.isActive &&
        (a.branches.allBranches || a.branches.branchIds.includes(b.id)),
    )
    .map((b) => ({ id: b.id, nameAr: b.nameAr, nameEn: b.nameEn }));
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
    const live = db.medical.visits.find(
      (v) => v.appointmentId === appt.id && v.status !== "cancelled",
    );
    if (live) throw new ApiError("visit_exists", undefined, { visitId: live.id });
    if (appt.status !== "arrived") throw new ApiError("appointment_not_arrived");
    return { patientId: appt.patientId, branchId: appt.branchId, appointmentId: appt.id };
  }
  if (!walkInBranchList(db, a).some((b) => b.id === input.branchId)) {
    throw new ApiError("forbidden");
  }
  const patient = patientOf(db, a, input.patientId);
  if (patient.status !== "active") throw new ApiError("patient_inactive");
  // Owner decision 2026-10-10: any active file may be seen in a branch the caller works in.
  return { patientId: patient.id, branchId: input.branchId, appointmentId: null };
}

export function createMockMedicalVisits(): Pick<
  MedicalApi,
  "listVisits" | "searchVisits" | "walkInBranches" | "walkInCandidates" | "startVisit" | "getVisit"
> {
  return {
    async listVisits(persona: Persona, patientId, rawQuery) {
      await delay();
      const db = getState();
      const query = parse(visitListQuerySchema, rawQuery);
      const a = requireKey(db, persona, "view", "visits", ["clinic", "branch", "own"]);
      patientOf(db, a, patientId);
      const rows = db.medical.visits
        .filter((v) => v.clinicId === a.clinic.id && v.patientId === patientId)
        .filter((v) => seesVisit(db, a, v))
        .sort(newestFirst);
      const result = page(db, a, rows, query.cursor, patientId);
      if (result.items.some((i) => i.preview !== null)) {
        auditMedical(db, a, "visit", "visit.previews_listed", patientId, ["preview"]);
        persist();
      }
      return result;
    },

    async searchVisits(persona, patientId, rawQuery) {
      await delay();
      const db = getState();
      const query = parse(visitSearchSchema, rawQuery);
      const a = requireKey(db, persona, "view", "medical", ["clinic", "own"]);
      patientOf(db, a, patientId);
      if (!reachesContent(db, a, "view", patientId)) throw new ApiError("not_found");
      const needle = query.q.toLocaleLowerCase();
      const hit = (text: string | null) => (text ?? "").toLocaleLowerCase().includes(needle);
      const rows = db.medical.visits
        .filter((v) => v.clinicId === a.clinic.id && v.patientId === patientId)
        .filter(
          (v) =>
            Object.values(v.note).some(hit) ||
            v.diagnoses.some((d) => !d.archived && hit(d.text)) ||
            v.addenda.some((x) => hit(x.body)),
        )
        .sort(newestFirst);
      // The query itself never reaches the audit row (P2-F4).
      auditMedical(db, a, "visit", "visit.searched", patientId, ["q"]);
      persist();
      return page(db, a, rows, query.cursor, patientId);
    },

    async walkInBranches(persona) {
      await delay(60);
      const db = getState();
      const a = requireKey(db, persona, "create", "visits", ["own"]);
      return { items: walkInBranchList(db, a) };
    },

    async walkInCandidates(persona, rawInput) {
      await delay();
      const db = getState();
      const input = parse(walkInSearchSchema, rawInput);
      const a = requireKey(db, persona, "create", "visits", ["own"]);
      if (!walkInBranchList(db, a).some((b) => b.id === input.branchId)) {
        throw new ApiError("forbidden");
      }
      const needle = input.q.toLocaleLowerCase();
      const digits = /^\d+$/.test(input.q) ? Number(input.q) : null;
      const items = db.patients
        .filter(
          (p) =>
            p.clinicId === a.clinic.id &&
            p.status === "active" &&
            p.registrationBranchId === input.branchId &&
            (p.fullName.toLocaleLowerCase().includes(needle) || p.fileNumber === digits),
        )
        .slice(0, 20)
        .map((p) => ({ patientId: p.id, fullName: p.fullName, fileNumber: p.fileNumber }));
      auditMedical(db, a, "visit", "visit.walk_in_searched", input.branchId, ["q"]);
      persist();
      return { items };
    },

    async startVisit(persona, rawInput, idempotencyKey) {
      await delay();
      const db = getState();
      const input = parse(visitStartSchema, rawInput);
      const a = requireKey(db, persona, "create", "visits", ["own"]);
      const replayKey = actorReplayKey(a.clinic.id, a.member.id, idempotencyKey);
      const previous = db.medical.idempotentVisits[replayKey];
      if (previous) {
        if (previous.fingerprint !== fingerprint(input)) throw new ApiError("idempotency_conflict");
        const replayed = db.medical.visits.find((v) => v.id === previous.visitId);
        if (replayed) return detailOf(db, a, replayed);
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
      auditMedical(db, a, "visit", "visit.started", visit.id, [], "draft");
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
      auditMedical(db, a, "visit", "visit.opened", v.id, detail.content ? ["content"] : []);
      persist();
      return detail;
    },
  };
}
