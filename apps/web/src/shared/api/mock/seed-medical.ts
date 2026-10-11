import type { MockState } from "./mock-store";
import type { StoredVisit } from "./mock-medical-state";

// Demo medical content for the first clinic (P2): made-up text only, no real person, phone or ID.
// Visits go to the doctors' own patients (files with a live appointment with them).

const DAY = 86_400_000;

const MEDICINES = [
  { name: "Sertraline 50 mg", defaultDose: "1 tablet", defaultFrequency: "Once daily" },
  { name: "Escitalopram 10 mg", defaultDose: "1 tablet", defaultFrequency: "Once daily" },
  { name: "Paracetamol 500 mg", defaultDose: "1–2 tablets", defaultFrequency: "Every 6 hours" },
  { name: "Melatonin 3 mg", defaultDose: "1 tablet", defaultFrequency: "At bedtime" },
];

function visit(
  base: Pick<StoredVisit, "id" | "clinicId" | "patientId" | "branchId" | "providerMembershipId">,
  daysAgo: number,
  now: number,
  signed: boolean,
): StoredVisit {
  const startedAt = new Date(now - daysAgo * DAY).toISOString();
  return {
    ...base,
    appointmentId: null,
    status: signed ? "signed" : "draft",
    startedAt,
    signedAt: signed ? new Date(now - daysAgo * DAY + 40 * 60_000).toISOString() : null,
    cancelReason: null,
    cancelNote: null,
    note: {
      complaint: "Trouble sleeping for three weeks, low mood in the mornings.",
      examination: "Calm, cooperative, speech normal in rate and tone.",
      assessment: signed
        ? "Mild depressive episode; sleep onset insomnia. Safety screen negative."
        : "Follow-up: sleep improving, mood still low on weekdays.",
      plan: signed ? "Start medication, sleep hygiene, review in four weeks." : null,
    },
    diagnoses: signed
      ? [
          {
            position: 0,
            kind: "icd10",
            code: "F32.0",
            text: "Major depressive disorder, single episode, mild",
            archived: false,
          },
          { position: 1, kind: "text", code: null, text: "Work-related stress", archived: false },
        ]
      : [],
    prescription: signed
      ? [
          {
            position: 0,
            medicine: "Sertraline 50 mg",
            dose: "1 tablet",
            frequency: "Once daily",
            duration: "4 weeks",
            note: "After breakfast",
            archived: false,
          },
        ]
      : [],
    addenda: [],
  };
}

export function seedMedical(state: MockState, clinicId: string, makeId: () => string): void {
  const now = Date.now();
  for (const m of MEDICINES) {
    state.medical.medicines.push({ id: makeId(), clinicId, status: "active", ...m });
  }
  const doctorRoles = new Set(
    state.roles.filter((r) => r.clinicId === clinicId && r.systemKey === "doctor").map((r) => r.id),
  );
  const doctors = state.members.filter(
    (m) => m.clinicId === clinicId && m.status === "active" && doctorRoles.has(m.roleId),
  );
  for (const doctor of doctors) {
    const seen = new Set<string>();
    const own = state.appointments.filter(
      (a) => a.providerMembershipId === doctor.id && a.status !== "cancelled",
    );
    for (const appt of own) {
      if (seen.has(appt.patientId) || seen.size >= 2) continue;
      seen.add(appt.patientId);
      const base = {
        clinicId,
        patientId: appt.patientId,
        branchId: appt.branchId,
        providerMembershipId: doctor.id,
      };
      const signed = visit({ ...base, id: makeId() }, 30 + seen.size, now, true);
      signed.addenda.push({
        id: makeId(),
        authorMembershipId: doctor.id,
        body: "Patient called: mild nausea in the first week, settled.",
        createdAt: new Date(now - 25 * DAY).toISOString(),
      });
      state.medical.visits.push(signed, visit({ ...base, id: makeId() }, 2, now, false));
      if (seen.size === 1) {
        state.medical.profiles.push({
          clinicId,
          patientId: appt.patientId,
          allergies: "Penicillin (rash)",
          chronicConditions: null,
          currentMedications: "Sertraline 50 mg once daily",
          surgicalHistory: "Appendectomy, childhood",
          familyHistory: "Mother: hypertension",
          updatedAt: new Date(now - 30 * DAY).toISOString(),
          updatedBy: doctor.id,
        });
      }
    }
  }
}
