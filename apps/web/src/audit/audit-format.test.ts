import { describe, expect, it } from "vitest";
import { clinicStatusSchema, moduleSchema, specialtySchema } from "@eyadex/contracts/clinics";
import { languageSchema } from "@eyadex/contracts/common";
import { invitationStatusSchema } from "@eyadex/contracts/invitations";
import { genderSchema, patientStatusSchema } from "@eyadex/contracts/patients";
import {
  AUDIT_ACTIONS,
  CLINIC_AUDIT_ACTIONS,
  PLATFORM_AUDIT_ACTIONS,
  platformAuditEntitySchema,
} from "@eyadex/contracts/audit";
import { clinicAuditEntitySchema } from "@eyadex/contracts/organization";
import { PERMISSION_CATALOG } from "@eyadex/contracts/permissions";
import { membershipUserStatusSchema } from "@eyadex/contracts/users";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { enabledFlags, translateAuditValue } from "./audit-format";

function lookup(dict: unknown) {
  return (key: string): string => {
    let node: unknown = dict;
    for (const part of key.split(".")) {
      if (node && typeof node === "object" && part in node)
        node = (node as Record<string, unknown>)[part];
      else return key;
    }
    return typeof node === "string" ? node : key;
  };
}

const CODED = [
  ...clinicStatusSchema.options,
  ...specialtySchema.options,
  ...languageSchema.options,
  ...moduleSchema.options,
  ...invitationStatusSchema.options,
  ...membershipUserStatusSchema.options,
  ...genderSchema.options,
  ...patientStatusSchema.options,
  "invited",
];

describe("audit value translations", () => {
  for (const [lang, dict] of [
    ["ar", ar],
    ["en", en],
  ] as const) {
    it(`translates every coded value and permission key (${lang})`, () => {
      const tr = lookup(dict);
      const missing = [...CODED, ...PERMISSION_CATALOG.map((p) => p.key)].filter(
        (v) => translateAuditValue(v, tr) === null,
      );
      expect(missing).toEqual([]);
    });
  }
  it("keeps the action filter catalog and the action labels in sync", () => {
    for (const dict of [ar, en]) {
      const labelled: string[] = [];
      for (const [group, actions] of Object.entries(dict.audit.actions))
        for (const action of Object.keys(actions as Record<string, string>))
          labelled.push(`${group}.${action}`);
      expect([...labelled].sort()).toEqual([...AUDIT_ACTIONS].sort());
    }
  });

  it("keeps the audit entity schemas and the entity labels in sync", () => {
    const schemas = new Set<string>([
      ...clinicAuditEntitySchema.options,
      ...platformAuditEntitySchema.options,
    ]);
    for (const dict of [ar, en]) {
      expect(Object.keys(dict.audit.entities).sort()).toEqual([...schemas].sort());
    }
    // Written by the API and the worker for the clinic mail provider (ADR-0014): readable on both screens.
    expect(clinicAuditEntitySchema.safeParse("clinic_mail_provider").success).toBe(true);
    expect(platformAuditEntitySchema.safeParse("clinic_mail_provider").success).toBe(true);
  });

  it("offers each screen exactly the actions its log can contain", () => {
    const clinic: readonly string[] = CLINIC_AUDIT_ACTIONS;
    const platform: readonly string[] = PLATFORM_AUDIT_ACTIONS;
    expect(clinic).toContain("clinic.settings_updated");
    expect(clinic).not.toContain("clinic.subscription_updated");
    expect(platform.some((a) => a.startsWith("patient."))).toBe(false);
    expect(platform).toContain("clinic.settings_updated");
    expect(platform).toContain("platform_account.joined");
    // Written by the worker, not the API (ADR-0013 §12): both screens must still offer and label it.
    expect(clinic).toContain("invitation.auto_cancelled");
    expect(platform).toContain("invitation.auto_cancelled");
  });
});

describe("module maps in audit snapshots", () => {
  it("lists the modules switched on, and nothing for an all-off map", () => {
    expect(enabledFlags({ patients: true })).toEqual(["patients"]);
    expect(enabledFlags({ patients: false })).toEqual([]);
  });
  it("leaves any other value to the caller", () => {
    for (const value of [null, true, "patients", ["patients"], {}, { nameAr: "x", nameEn: "y" }])
      expect(enabledFlags(value)).toBeNull();
    expect(enabledFlags({ patients: true, note: "x" })).toBeNull();
  });
});
