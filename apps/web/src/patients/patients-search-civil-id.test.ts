import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/api/mock/mock-store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/shared/api/mock/mock-store")>();
  return { ...real, delay: async () => undefined };
});

const { resetMockData } = await import("@/shared/api/mock/mock-store");
const { ALL, api, as, branches, input } = await import("./patients-test-kit");

// P2-F5: the API stores the civil ID encrypted, so only the whole number can be looked up. The mock
// search follows it exactly. Both numbers are fictional and well-formed (the test kit's fixture).
const FULL = "290040112347"; // 1990-04-01
const PHONE = "55501239";
const inScript = (zero: number, digits: string) =>
  digits.replace(/\d/g, (d) => String.fromCharCode(zero + Number(d)));

async function file() {
  const branch = branches()[0];
  if (!branch) throw new Error("no branch");
  const admin = as("clinic_admin");
  const created = await api.patients.create(admin, input(branch.id, PHONE), crypto.randomUUID());
  return { admin, created };
}

describe("patients mock: civil ID is found only by its whole number", () => {
  beforeEach(() => resetMockData());

  it("the full 12 digits find the file, and the row still shows only the last 4", async () => {
    const { admin, created } = await file();
    const list = await api.patients.list(admin, { ...ALL, q: FULL });
    expect(list.items.map((p) => p.id)).toContain(created.id);
    const row = list.items.find((p) => p.id === created.id);
    expect(row?.civilIdLast4).toBe("2347");
    expect(row).not.toHaveProperty("civilId");
  });

  it.each([
    ["its last 4", "2347"],
    ["its first 11", "29004011234"],
    ["a middle run", "0040112347"],
    ["13 digits", "2900401123477"],
  ])("any other digit query (%s) never finds the file by its number", async (_name, q) => {
    const { admin, created } = await file();
    const list = await api.patients.list(admin, { ...ALL, q });
    expect(list.items.map((p) => p.id)).not.toContain(created.id);
  });

  it("the whole number still counts when typed with dashes or in Arabic-Indic digits", async () => {
    const { admin, created } = await file();
    for (const q of ["290-040-112-347", inScript(0x0660, FULL), inScript(0x06f0, FULL)]) {
      const list = await api.patients.list(admin, { ...ALL, q });
      expect(list.items.map((p) => p.id)).toContain(created.id);
    }
  });

  it("a digit query that is not a civil ID still finds the file by phone and by file number", async () => {
    const { admin, created } = await file();
    for (const q of ["5550123", "55501239", String(created.fileNumber)]) {
      const list = await api.patients.list(admin, { ...ALL, q });
      expect(list.items.map((p) => p.id)).toContain(created.id);
    }
  });
});
