import { DrizzleQueryError } from "drizzle-orm";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { asDatabaseError, DatabaseError } from "../database-error.ts";

/**
 * `fn` بيمسك فشل driver حقيقي ويرميه ملفوف في خطأ بتاعه. الخطأ الخارجي بتاع `fn` ومش بيتحوّل —
 * بس اللي جواه (`detail` فيه صف المراجع، و`DrizzleQueryError` فيه الـ query والـ params) لازم
 * يتشال قبل ما يعدّي حدود الداتابيز. (Codex على PR #22، P1.)
 */
const postgresErrorClass = (
  postgres as unknown as { readonly PostgresError?: new (fields: Record<string, unknown>) => Error }
).PostgresError;

const PATIENT_ROW = "Key (clinic_id, phone)=(0192, +96555501234) already exists.";

const realFailure = () =>
  new postgresErrorClass!({
    code: "23505",
    message: 'duplicate key value violates unique constraint "patients_clinic_id_phone_key"',
    detail: PATIENT_ROW,
    constraint_name: "patients_clinic_id_phone_key",
    table_name: "patients",
  });

/** كل اللي ممكن يتطبع من الخطأ — الرسائل والـ causes وكل الحقول، حتى غير الـ enumerable. */
const everythingPrintable = (error: unknown): string => {
  const seen = new Set<unknown>();
  const walk = (node: unknown): string => {
    if (typeof node !== "object" || node === null || seen.has(node)) return String(node);
    seen.add(node);
    return Object.getOwnPropertyNames(node)
      .map((key) => `${key}=${walk((node as Record<string, unknown>)[key])}`)
      .join(" ");
  };
  return walk(error);
};

describe("a driver failure wrapped by fn loses its row data, fn's error stays fn's", () => {
  it("replaces the cause with identifiers only and keeps the wrapper itself", () => {
    const wrapper = new Error("could not save the patient file", { cause: realFailure() });
    const result = asDatabaseError(wrapper);
    expect(result).toBe(wrapper);
    expect((result as Error).message).toBe("could not save the patient file");
    const cause = (result as Error).cause;
    expect(cause).toBeInstanceOf(DatabaseError);
    expect((cause as DatabaseError).code).toBe("23505");
    expect((cause as DatabaseError).constraint).toBe("patients_clinic_id_phone_key");
    expect(everythingPrintable(result)).not.toContain("+96555501234");
  });

  it("reaches a failure two wrappers deep, and a DrizzleQueryError's query and params", () => {
    const drizzle = new DrizzleQueryError(
      "insert into patients (phone) values ($1)",
      ["+96555501234"],
      realFailure(),
    );
    const outer = new Error("use case failed", {
      cause: new Error("repository failed", { cause: drizzle }),
    });
    expect(asDatabaseError(outer)).toBe(outer);
    const printable = everythingPrintable(outer);
    expect(printable).not.toContain("+96555501234");
    expect(printable).not.toContain("insert into patients");
  });

  it("cleans an AggregateError's errors (Promise.any / allSettled in fn)", () => {
    const aggregate = new AggregateError([new Error("other"), realFailure()], "all failed");
    expect(asDatabaseError(aggregate)).toBe(aggregate);
    expect(aggregate.errors[1]).toBeInstanceOf(DatabaseError);
    expect(everythingPrintable(aggregate)).not.toContain(PATIENT_ROW);
  });

  it("fails closed when the wrapper is frozen: the whole error becomes DatabaseError", () => {
    const frozen = Object.freeze(new Error("frozen wrapper", { cause: realFailure() }));
    const result = asDatabaseError(frozen);
    expect(result).toBeInstanceOf(DatabaseError);
    expect(everythingPrintable(result)).not.toContain(PATIENT_ROW);
  });

  it("survives a cause cycle and leaves fn's SQLSTATE-shaped values alone", () => {
    const first = new Error("first") as Error & { cause?: unknown };
    const second = new Error("second", { cause: first });
    first.cause = second;
    expect(asDatabaseError(first)).toBe(first);
    const shaped = { code: "23505", detail: "fn's own validation" };
    const own = new Error("validation", { cause: shaped });
    expect(asDatabaseError(own)).toBe(own);
    expect(own.cause).toBe(shaped);
  });
});

describe("the depth cap fails closed (Codex, PR #22)", () => {
  const chain = (levels: number, bottom: unknown): Error[] => {
    const nodes: Error[] = [];
    let below: unknown = bottom;
    for (let level = 0; level < levels; level += 1) {
      const node = new Error(`wrapper ${levels - level}`, { cause: below });
      nodes.unshift(node);
      below = node;
    }
    return nodes;
  };

  it("cuts a chain deeper than the cap instead of trusting what it did not read", () => {
    const nodes = chain(12, realFailure());
    const outer = nodes[0]!;
    expect(asDatabaseError(outer)).toBe(outer);
    const printable = everythingPrintable(outer);
    expect(printable).not.toContain(PATIENT_ROW);
    expect(printable).toContain("error cause chain cut");
  });

  it("drops the whole error when the cut itself is impossible (frozen past the cap)", () => {
    const nodes = chain(12, realFailure());
    nodes.forEach((node) => Object.freeze(node));
    const result = asDatabaseError(nodes[0]);
    expect(result).not.toBe(nodes[0]);
    expect((result as Error).message).toContain("error cause chain cut");
    expect(everythingPrintable(result)).not.toContain(PATIENT_ROW);
  });
});
