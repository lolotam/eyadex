import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { I18nProvider } from "@/shared/i18n/i18n-provider";
import { AuditDetailDialog } from "./audit-detail-dialog";

// A medical audit row records only the names of the fields a write changed (`after.changed`, R3-4):
// the dialog names that list and each field in the reader's language, never the code identifiers.
afterEach(() => cleanup());

// Every field name the API's medical module writes (`auditMedical`, the medicines audit) and the mock's.
const MEDICAL_FIELDS = [
  "status",
  "complaint",
  "examination",
  "assessment",
  "plan",
  "cancelReason",
  "cancelNote",
  "body",
  "items",
  "file",
  "allergies",
  "chronicConditions",
  "currentMedications",
  "surgicalHistory",
  "familyHistory",
  "name",
  "defaultDose",
  "defaultFrequency",
  "reason",
  "note",
];

describe("the audit detail of a medical write", () => {
  it("shows the changed fields' label and names in Arabic", async () => {
    render(
      <I18nProvider manageDocument={false}>
        <AuditDetailDialog
          entry={{
            at: "2026-10-01T09:00:00.000Z",
            actorName: "د. سارة",
            action: "visit.note_saved",
            entity: "visit",
            category: "patient_access",
            before: null,
            after: { changed: ["complaint", "plan"] },
          }}
          timeZone="Asia/Kuwait"
          onClose={() => {}}
        />
      </I18nProvider>,
    );
    expect(await screen.findByText(ar.audit.fields.changed)).toBeInTheDocument();
    const names = new Intl.ListFormat("ar", { type: "unit" }).format(["الشكوى", "الخطة"]);
    expect(screen.getByText(names)).toBeInTheDocument();
    expect(screen.queryByText(/complaint|changed/)).toBeNull();
  });

  it("labels every medical field name in both languages", () => {
    for (const dict of [ar, en]) {
      const labels = dict.audit.fields as Record<string, string>;
      expect(MEDICAL_FIELDS.filter((f) => !labels[f])).toEqual([]);
    }
  });
});
