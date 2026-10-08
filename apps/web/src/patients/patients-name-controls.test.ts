import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  patientInputSchema,
  patientListQuerySchema,
  stripInvisibleControls,
} from "@eyadex/contracts/patients";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { resetMockData } = await import("@/shared/api/mock/mock-store");
const { ALL, api, as, branches, input } = await import("./patients-test-kit");

// Written as code points so no invisible character sits in this source file.
const ZWJ = String.fromCharCode(0x200d);
const RLO = String.fromCharCode(0x202e);
const SOFT_HYPHEN = String.fromCharCode(0x00ad);
const BOM = String.fromCharCode(0xfeff);
const BELL = String.fromCharCode(0x0007);

// Names and search terms drop invisible format/control characters (ADR-0018): they render as nothing,
// so they could only split an identifier past a check or reorder a name on screen.
describe("invisible controls in patient free text", () => {
  beforeEach(() => resetMockData());

  it("stripInvisibleControls drops format and control characters but keeps whitespace", () => {
    expect(stripInvisibleControls(`${RLO}No${ZWJ}ura${SOFT_HYPHEN}${BOM}${BELL}\tA`)).toBe(
      "Noura\tA",
    );
  });

  it("the form schema stores the visible name, and a name of controls only is empty", () => {
    const base = { ...input("0190a000-0000-7000-8000-0000000000b1"), civilId: "" };
    const parsed = patientInputSchema.parse({ ...base, fullName: ` ${RLO}Noura${ZWJ} ` });
    expect(parsed.fullName).toBe("Noura");
    expect(patientInputSchema.safeParse({ ...base, fullName: `${ZWJ}${BOM}` }).success).toBe(false);
  });

  it("the search term is cleaned the same way", () => {
    expect(patientListQuerySchema.parse({ ...ALL, q: `55${ZWJ}50` }).q).toBe("5550");
  });

  it("the mock files the visible name, and search finds it by its visible spelling", async () => {
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    const admin = as("clinic_admin");
    const created = await api.patients.create(
      admin,
      { ...input(branch.id, "55501238"), civilId: "", fullName: `Sa${ZWJ}ra${SOFT_HYPHEN}h` },
      crypto.randomUUID(),
    );
    expect(created.detail?.fullName).toBe("Sarah");
    const found = await api.patients.list(admin, { ...ALL, q: "Sarah" });
    expect(found.items.map((p) => p.id)).toContain(created.id);
  });
});
