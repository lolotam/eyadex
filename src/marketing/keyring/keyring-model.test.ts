import { describe, expect, it } from "vitest";
import { ROLE_TEMPLATES } from "@/shared/api/mock/seed-roles";
import { ar } from "../i18n/ar";
import { en } from "../i18n/en";
import { buildCaption, computeView } from "./keyring-model";

describe("keyring model", () => {
  it("team key sees nothing", () => {
    const v = computeView("team");
    expect(v.refused).toBe(true);
    expect(v.rows.every((r) => !r.visible)).toBe(true);
    expect(v.sidebar).toEqual(["overview"]);
    expect(v.openFile).toBeNull();
    expect(v.buttons).toEqual({ create: false, update: false, deactivate: false });
  });

  it("doctor sees only Salmiya rows and opens 1042", () => {
    const v = computeView("doctor");
    expect(v.rows.filter((r) => r.visible).every((r) => r.patient.branch === "salmiya")).toBe(true);
    expect(v.rows.filter((r) => r.visible)).toHaveLength(3);
    expect(v.openFile).toBe(1042);
  });

  it("technician opens the first Hawalli file", () => {
    expect(computeView("tech").openFile).toBe(1044);
  });

  it("buttons follow ROLE_TEMPLATES", () => {
    const map = { admin: "clinic_admin", doctor: "doctor", receptionist: "receptionist", tech: "technician" } as const;
    for (const [key, role] of Object.entries(map)) {
      const perms = ROLE_TEMPLATES[role].permissions;
      const v = computeView(key as keyof typeof map);
      expect(v.buttons.create).toBe(perms.some((p) => p.startsWith("create:patients:")));
      expect(v.buttons.update).toBe(perms.some((p) => p.startsWith("update:patients:")));
      expect(v.buttons.deactivate).toBe(perms.some((p) => p.startsWith("deactivate:patients:")));
    }
  });

  it("captions read true in both languages", () => {
    const v = computeView("doctor");
    expect(buildCaption(v, ar.keyring.caption, (b) => ar.keyring.branches[b])).toBe(
      "يرى مرضى فرع السالمية فقط، ويستطيع الإضافة والتعديل.",
    );
    expect(buildCaption(v, en.keyring.caption, (b) => en.keyring.branches[b])).toBe(
      "Sees Salmiya patients only, and can add and edit.",
    );
  });
});
