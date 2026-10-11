import type { ClinicAuditEntry } from "@eyadex/contracts/organization";
import type { VisitDetail, VisitSummary } from "@eyadex/contracts/visits";
import { writeClinicAudit } from "./mock-audit";
import { reachesContent, type MedicalAccess } from "./mock-medical-access";
import type { StoredVisit } from "./mock-medical-state";
import type { MockState } from "./mock-store";

const nameOf = (db: MockState, memberId: string) =>
  db.members.find((m) => m.id === memberId)?.fullName ?? "";

/**
 * spec §4, as the API's `isSignable`: a note section that is not blank or an active diagnosis. One
 * rule for the Sign button (`can.sign`) and the sign itself (`visit_empty`).
 */
export function isSignable(v: StoredVisit): boolean {
  return (
    v.diagnoses.some((d) => !d.archived) ||
    Object.values(v.note).some((text) => text !== null && text.trim() !== "")
  );
}

/** A visit's metadata; the preview only with `view:medical:*` reaching the file. */
export function summaryOf(db: MockState, a: MedicalAccess, v: StoredVisit): VisitSummary {
  const content = reachesContent(db, a, "view", v.patientId);
  return {
    id: v.id,
    patientId: v.patientId,
    branchId: v.branchId,
    providerMembershipId: v.providerMembershipId,
    providerName: nameOf(db, v.providerMembershipId),
    appointmentId: v.appointmentId,
    status: v.status,
    startedAt: v.startedAt,
    signedAt: v.signedAt,
    // As the API's `previewOf`: no assessment is no preview, so the list writes no audited read for it.
    preview: content && v.note.assessment !== null ? v.note.assessment.slice(0, 160) : null,
    cancelReason: v.cancelReason,
  };
}

/** The visit page: content only with `view:medical:*`; `can` follows the provider rule (P2-3). */
export function detailOf(db: MockState, a: MedicalAccess, v: StoredVisit): VisitDetail {
  const patient = db.patients.find((p) => p.id === v.patientId);
  const branch = db.branches.find((b) => b.id === v.branchId);
  const content = reachesContent(db, a, "view", v.patientId);
  const writer =
    v.providerMembershipId === a.member.id && reachesContent(db, a, "update", v.patientId);
  const draft = v.status === "draft";
  return {
    visit: summaryOf(db, a, v),
    patient: { fullName: patient?.fullName ?? "", fileNumber: patient?.fileNumber ?? 0 },
    branch: { nameAr: branch?.nameAr ?? "", nameEn: branch?.nameEn ?? "" },
    content: content
      ? {
          note: { ...v.note },
          diagnoses: v.diagnoses
            .filter((d) => !d.archived)
            .map((d) => ({ position: d.position, kind: d.kind, code: d.code, text: d.text })),
          prescription: v.prescription
            .filter((p) => !p.archived)
            .map((p) => ({
              position: p.position,
              medicine: p.medicine,
              dose: p.dose,
              frequency: p.frequency,
              duration: p.duration,
              note: p.note,
            })),
          addenda: v.addenda.map((x) => ({
            id: x.id,
            authorName: nameOf(db, x.authorMembershipId),
            body: x.body,
            createdAt: x.createdAt,
          })),
          attachments: db.medical.attachments
            .filter((x) => x.visitId === v.id && x.status === "active")
            .map(({ clinicId: _clinic, ...rest }) => rest),
          cancelNote: v.cancelNote,
        }
      : null,
    can: {
      edit: writer && draft,
      sign: writer && draft && isSignable(v),
      cancel: writer && draft,
      addAddendum: writer && v.status === "signed",
      // As the API's `mayAttach`: the upload's own rule (update reach, active file), whatever the
      // visit's status or provider and whether the content is readable.
      attach: patient?.status === "active" && reachesContent(db, a, "update", v.patientId),
    },
  };
}

/**
 * A medical audit row (spec §5): patient access for everything except medicines, and only the NAMES
 * of the fields involved, as `after.changed` like the API — never their text, a code, a medicine, a
 * query or a civil ID.
 */
export function auditMedical(
  db: MockState,
  a: MedicalAccess,
  entity: ClinicAuditEntry["entity"],
  action: string,
  entityId: string,
  fields: readonly string[] = [],
  status?: string,
): void {
  writeClinicAudit(db, {
    clinicId: a.clinic.id,
    actorName: a.actorName,
    action,
    entity,
    before: null,
    after: { id: entityId, changed: [...fields], ...(status ? { status } : {}) },
  });
}
