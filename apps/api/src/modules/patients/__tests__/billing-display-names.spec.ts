import type { Tx } from "@eyadex/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { PgBillingPatients } from "../persistence/pg-billing-patients.ts";

const CLINIC = "0190a000-0000-7000-8000-000000000001";
const PATIENT = "0190a000-0000-7000-8000-000000000002";
const OTHER = "0190a000-0000-7000-8000-000000000003";
const reader = new PgBillingPatients();
const database = (rows: { id: string; full_name: string }[] = []) => {
  const execute = vi.fn<Tx["execute"]>().mockResolvedValue(rows);
  return { execute, tx: { execute } as unknown as Tx };
};

describe("billing displayNames", () => {
  it("does not query an empty page", async () => {
    const { tx, execute } = database();
    expect(await reader.displayNames(tx, CLINIC, [])).toEqual(new Map());
    expect(execute).not.toHaveBeenCalled();
  });

  it("collapses duplicate ids into one bound batch and returns only display names", async () => {
    const { tx, execute } = database([{ id: PATIENT, full_name: "مراجع تجريبي" }]);
    expect(await reader.displayNames(tx, CLINIC, [PATIENT, PATIENT, OTHER])).toEqual(
      new Map([[PATIENT, "مراجع تجريبي"]]),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    const statement = execute.mock.calls[0]?.[0];
    if (statement === undefined) throw new Error("expected batch query");
    const query = new PgDialect().sqlToQuery(statement.getSQL());
    expect(query.params).toEqual([CLINIC, `${PATIENT},${OTHER}`]);
  });

  it("returns no entry when the clinic-scoped query finds no patient", async () => {
    const { tx, execute } = database();
    expect(await reader.displayNames(tx, CLINIC, [OTHER])).toEqual(new Map());
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
