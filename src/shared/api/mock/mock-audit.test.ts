import { describe, expect, it } from "vitest";
import { writeClinicAudit } from "./mock-audit";
import { buildSeed } from "./seed";

describe("clinic audit categories", () => {
  it("always labels patient entities as patient access and other entities as administrative", () => {
    const db = buildSeed();
    const clinicId = db.clinics[0]?.id;
    if (!clinicId) throw new Error("Missing clinic seed");

    for (const action of [
      "patient.opened",
      "patient.created",
      "patient.updated",
      "patient.archived",
    ]) {
      writeClinicAudit(db, {
        clinicId,
        actorName: "Test actor",
        action,
        entity: "patient",
        before: { id: crypto.randomUUID() },
        after: null,
      });
    }
    writeClinicAudit(db, {
      clinicId,
      actorName: "Test actor",
      action: "branch.updated",
      entity: "branch",
      before: { id: crypto.randomUUID() },
      after: null,
    });

    expect(db.clinicAudit).toHaveLength(5);
    expect(db.clinicAudit.filter((entry) => entry.entity === "patient")).toHaveLength(4);
    expect(
      db.clinicAudit.every(
        (entry) =>
          entry.category === (entry.entity === "patient" ? "patient_access" : "administrative"),
      ),
    ).toBe(true);
  });
});
