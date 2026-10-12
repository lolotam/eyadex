import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSeed } from "./seed";

const fixtureId = (index: number) =>
  `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;

afterEach(() => vi.useRealTimers());

describe("patient seed extraction preserves the demo", () => {
  it("keeps counts, stable IDs, patient preferences and appointment/medical links", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T00:00:00.000Z"));
    const db = buildSeed();
    expect(db.clinics.map((clinic) => clinic.id)).toEqual([4, 106, 157].map(fixtureId));
    expect(db.branches).toHaveLength(6);
    expect(db.members).toHaveLength(18);
    expect(db.patients).toHaveLength(37);
    expect(db.appointments).toHaveLength(16);
    expect(db.medical.visits).toHaveLength(8);

    const patientStarts = [25, 127, 178];
    const patientCounts = [25, 6, 6];
    for (const [index, clinic] of db.clinics.entries()) {
      const patients = db.patients.filter((patient) => patient.clinicId === clinic.id);
      const count = patientCounts[index]!;
      expect(patients.map((patient) => patient.id)).toEqual(
        Array.from({ length: count }, (_, offset) => fixtureId(patientStarts[index]! + offset)),
      );
      expect(patients.map((patient) => patient.fileNumber)).toEqual(
        Array.from({ length: count }, (_, offset) => offset + 1),
      );
      expect(db.patientCounters[clinic.id]).toBe(count);
      expect(patients[0]?.createdAt).toBe(clinic.createdAt);
      expect(patients.filter((patient) => patient.status === "archived")).toHaveLength(
        index === 0 ? 2 : 1,
      );
      for (const [offset, patient] of patients.entries()) {
        expect(patient.email).toBe(
          offset % 2 === 0 ? `patient${offset + 1}.c${index + 1}@example.invalid` : null,
        );
        expect(patient.messageLanguage).toBe(offset % 5 === 0 ? "en" : null);
        expect(patient.notificationsOptOut).toBe(offset % 4 === 3);
        const branches = db.branches.filter((branch) => branch.clinicId === clinic.id);
        expect(patient.registrationBranchId).toBe(branches[offset % 2]?.id);
      }
    }

    for (const appointment of db.appointments) {
      expect(
        db.patients.some(
          (patient) =>
            patient.id === appointment.patientId && patient.clinicId === appointment.clinicId,
        ),
      ).toBe(true);
      expect(
        db.members.some(
          (member) =>
            member.id === appointment.providerMembershipId &&
            member.clinicId === appointment.clinicId,
        ),
      ).toBe(true);
      expect(
        db.branches.some(
          (branch) =>
            branch.id === appointment.branchId && branch.clinicId === appointment.clinicId,
        ),
      ).toBe(true);
    }
    for (const visit of db.medical.visits) {
      expect(
        db.appointments.some(
          (appointment) =>
            appointment.patientId === visit.patientId &&
            appointment.providerMembershipId === visit.providerMembershipId &&
            appointment.clinicId === visit.clinicId,
        ),
      ).toBe(true);
    }
  });
});
