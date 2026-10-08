import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchDigits } from "@eyadex/contracts/patients";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { resetMockData } = await import("@/shared/api/mock/mock-store");
const { ALL, api, as, branches, input } = await import("./patients-test-kit");

const inScript = (zero: number, digits: string) =>
  digits.replace(/\d/g, (d) => String.fromCharCode(zero + Number(d)));
const SCRIPTS = [
  ["Arabic-Indic", 0x0660],
  ["Persian", 0x06f0],
  ["full-width", 0xff10],
] as const;

// A phone, file number or civil ID typed on an Arabic or Persian keyboard searches like ASCII digits,
// the same rule as the API (ADR-0018).
describe("patients mock: search digits in any script", () => {
  beforeEach(() => resetMockData());

  it.each(SCRIPTS)("searchDigits folds %s digits to ASCII", (_name, zero) => {
    expect(searchDigits(`+965 ${inScript(zero, "5550")}-12`)).toBe("965555012");
  });

  it.each(SCRIPTS)("a phone typed in %s digits finds the file", async (_name, zero) => {
    const branch = branches()[0];
    if (!branch) throw new Error("no branch");
    const admin = as("clinic_admin");
    const created = await api.patients.create(
      admin,
      { ...input(branch.id, "55501239"), civilId: "" },
      crypto.randomUUID(),
    );
    const found = await api.patients.list(admin, { ...ALL, q: inScript(zero, "55501239") });
    expect(found.items.map((p) => p.id)).toContain(created.id);
  });
});
