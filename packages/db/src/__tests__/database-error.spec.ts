import { DrizzleQueryError } from "drizzle-orm";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { asDatabaseError, DatabaseError } from "../database-error.ts";

/**
 * postgres.js بيلصق `PostgresError` على الـ factory نفسها. الـ types المرفقة مابيمرّرش الستاتيك
 * على الـ factory، فبنقراه من هنا — والاختبار ده بيأكد إن الحقل موجود فعلاً في النسخة المثبّتة
 * (postgres 3.4.9)، فلو حد غيّر النسخة لـ release بيكشف صنف تاني.
 */
const postgresErrorClass = (
  postgres as unknown as { readonly PostgresError?: new (fields: Record<string, unknown>) => Error }
).PostgresError;

/** failure حقيقي من postgres.js: SQLSTATE + معرّفات، زي ما PostgreSQL بيبعته. */
const realFailure = () =>
  new postgresErrorClass!({
    code: "23505",
    message: 'duplicate key value violates unique constraint "patients_clinic_id_file_number_key"',
    detail: "Key (clinic_id, file_number)=(0192, 1) already exists.",
    constraint_name: "patients_clinic_id_file_number_key",
    schema_name: "public",
    table_name: "patients",
    column_name: "file_number",
  });

describe("a genuine driver failure becomes DatabaseError", () => {
  it("the pinned postgres.js version really exports its error class", () => {
    expect(typeof postgresErrorClass).toBe("function");
    expect(realFailure()).toBeInstanceOf(Error);
  });

  it("wraps the DrizzleQueryError Drizzle throws around it, identifiers only", () => {
    const wrapped = new DrizzleQueryError(
      "insert into patients values ($1)",
      ["مراجع"],
      realFailure(),
    );
    const facts = asDatabaseError(wrapped);
    expect(facts).toBeInstanceOf(DatabaseError);
    const error = facts as DatabaseError;
    expect(error.code).toBe("23505");
    expect(error.constraint).toBe("patients_clinic_id_file_number_key");
    expect(error.table).toBe("patients");
    expect(error.column).toBe("file_number");
    expect(error.schema).toBe("public");
    expect(error.message).toBe(
      "database error 23505 (constraint patients_clinic_id_file_number_key)",
    );
    // لا SQL ولا parameters ولا detail — دي بتبقى بيانات مراجع
    for (const text of [error.message, String(error.stack), JSON.stringify(error)]) {
      expect(text).not.toContain("insert into patients");
      expect(text).not.toContain("Failing row");
      expect(text).not.toContain("already exists");
    }
  });

  it("wraps a bare PostgresError too — the driver can throw it without Drizzle in the way", () => {
    const facts = asDatabaseError(realFailure());
    expect(facts).toBeInstanceOf(DatabaseError);
    expect((facts as DatabaseError).code).toBe("23505");
  });

  it("passes an existing DatabaseError straight through", () => {
    const already = new DatabaseError({ code: "42501" });
    expect(asDatabaseError(already)).toBe(already);
  });
});

describe("an error that merely looks like a database failure is left alone", () => {
  // كل حالة هنا شكلها SQLSTATE، بس مفيش driver رماها — التحويل هنا معناه كود غلط بيوصل لوجهة
  // الـ API، فالسلوك الصح إنها تطلع زي ما هي.
  const shapedFailures: readonly (readonly [string, unknown])[] = [
    ["a bare object carrying a SQLSTATE", { code: "23505" }],
    [
      "an Error with a SQLSTATE field",
      Object.assign(new Error("use case validation"), { code: "23505" }),
    ],
    [
      "an Error whose cause is a SQLSTATE-shaped object",
      new Error("wrapped by a caller", { cause: { code: "23505" } }),
    ],
    [
      "an error two causes deep behind a cause",
      new Error("two deep", { cause: new Error("one deep", { cause: { code: "23505" } }) }),
    ],
    [
      // Drizzle بيحط الـ cause بتاعه، فلو حد لفّ error تاني_shape SQLSTATE جوه DrizzleQueryError
      // بالشكل ده، هو مش PostgresError حقيقي — وشكله لوحده مش دليل
      "a DrizzleQueryError whose cause is NOT the driver's error",
      new DrizzleQueryError(
        "select 1",
        [],
        Object.assign(new Error("not the driver"), { code: "23505" }),
      ),
    ],
    [
      "a look-alike class named like the driver's",
      Object.assign(new (class PostgresError extends Error {})("fake"), { code: "23505" }),
    ],
  ];

  it.each(shapedFailures)("rethrows %s as the very same object", (_label, thrown) => {
    expect(asDatabaseError(thrown)).toBe(thrown);
  });

  it("rethrows a non-SQLSTATE driver failure unchanged — a transport error has no query in it", () => {
    const transport = new Error("write ECONNREFUSED 127.0.0.1:5432");
    expect(asDatabaseError(transport)).toBe(transport);
  });
});
