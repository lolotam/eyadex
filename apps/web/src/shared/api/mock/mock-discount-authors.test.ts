import { beforeEach, describe, expect, it } from "vitest";
import type { Persona } from "@eyadex/contracts/session";
import { resetMockData } from "./mock-test-kit";
import { admin, api, freeLine, getState, issue, memberOf, range } from "./mock-report-test-kit";

beforeEach(() => resetMockData());

const off = (minor: string, reason = "خصم") => ({ kind: "amount" as const, minor, reason });

/** A second admin: the editor whose id a changed discount must take. */
function editor(): { persona: Persona; id: string } {
  const db = getState();
  const base = memberOf("clinic_admin");
  const id = crypto.randomUUID();
  db.members.push({ ...base, id, fullName: "محرر" });
  return { persona: { kind: "clinic_admin", clinicId: base.clinicId, memberId: id }, id };
}

async function edit(id: string, persona: Persona, lines: ReturnType<typeof freeLine>[], inv = null as ReturnType<typeof off> | null) {
  const v = await api.finance.getInvoice(admin(), id);
  return api.finance.edit(persona, id, v.version, { lines, invoiceDiscount: inv });
}

const authors = async () =>
  (await api.reports.discounts(admin(), range())).items
    .map((r) => `${r.kind}:${r.discountMinor}:${r.discountedBy}`)
    .sort();

describe("discount authors on edit (EY-10.2)", () => {
  it("an unchanged discount keeps its author", async () => {
    const issuer = memberOf("clinic_admin").id;
    const e = editor();
    const inv = await issue([freeLine("10000", off("1000")), freeLine("500")]);
    await edit(inv.id, e.persona, [freeLine("10000", off("1000")), freeLine("800")]);
    expect(await authors()).toEqual([`line:1000:${issuer}`]);
  });

  it("a changed discount takes the editor", async () => {
    const e = editor();
    const inv = await issue([freeLine("10000", off("1000"))]);
    await edit(inv.id, e.persona, [freeLine("10000", off("1500"))]);
    expect(await authors()).toEqual([`line:1500:${e.id}`]);
  });

  it("a moved discount takes the editor", async () => {
    const e = editor();
    const inv = await issue([freeLine("10000", off("1000")), freeLine("500")]);
    await edit(inv.id, e.persona, [freeLine("500"), freeLine("10000", off("1000"))]);
    expect(await authors()).toEqual([`line:1000:${e.id}`]);
  });

  it("a new invoice discount takes the editor; the same one keeps its author", async () => {
    const issuer = memberOf("clinic_admin").id;
    const e = editor();
    const inv = await issue([freeLine("10000")], undefined, off("700", "عام"));
    await edit(inv.id, e.persona, [freeLine("10000")], off("700", "عام"));
    expect(await authors()).toEqual([`invoice:700:${issuer}`]);
    await edit(inv.id, e.persona, [freeLine("10000")], off("900", "عام"));
    expect(await authors()).toEqual([`invoice:900:${e.id}`]);
  });
});
