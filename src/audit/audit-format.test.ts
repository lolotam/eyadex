import { describe, expect, it } from "vitest";
import { clinicStatusSchema, moduleSchema, specialtySchema } from "@contracts/clinics";
import { languageSchema } from "@contracts/common";
import { invitationStatusSchema } from "@contracts/invitations";
import { genderSchema, patientStatusSchema } from "@contracts/patients";
import { PERMISSION_CATALOG } from "@contracts/permissions";
import { membershipUserStatusSchema } from "@contracts/users";
import { ar } from "@/shared/i18n/ar";
import { en } from "@/shared/i18n/en";
import { translateAuditValue } from "./audit-format";

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
});
