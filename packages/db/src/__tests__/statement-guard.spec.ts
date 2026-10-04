import { describe, expect, it } from "vitest";

import { ForbiddenStatementError } from "../index.ts";
import { isWhitespace } from "../sql-lexer.ts";
import {
  ALLOWED_STATEMENT_WORDS,
  assertStatementAllowed,
  EMPTY_STATEMENT,
  forbiddenKeyword,
  MULTIPLE_STATEMENTS,
  UNTERMINATED_COMMENT,
} from "../statement-guard.ts";

/** جمل عادية: لازم تعدّي من غير ما الحارس يلمسها. */
const ALLOWED = [
  "SELECT 1",
  "select 1",
  "SELECT id FROM patients WHERE clinic_id = current_clinic()",
  "UPDATE branches SET name_ar = 'فرع' WHERE id = $1",
  "DELETE FROM invitations WHERE id = $1 RETURNING id",
  "WITH x AS (SELECT 1 AS n) SELECT n FROM x",
  // جملة ملفوفة في أقواس: أول قوس بيتقفل قبل SELECT، فـ SELECT هي أول كلمة
  "((( SELECT 1 ), ( SELECT 2 ))",
  "INSERT INTO branches (clinic_id, id) VALUES ($1, $2) RETURNING id",
  "TABLE branches",
  "VALUES (1), (2)",
  "MERGE INTO branches b USING staging s ON b.id = s.id WHEN MATCHED THEN UPDATE SET b.is_active = s.is_active",
  // كلمة بتبدأ بحرف من كلمة ممنوعة مش هي
  "SELECT settle FROM settings",
  "SELECT * FROM endpoints WHERE note = 'SETTINGS'",
  // التعليقات بتتقرا، والجملة اللي بعدها عادية
  "-- a helpful note\nSELECT 1",
  "/* x */ /* y */ SELECT 1",
];

/**
 * أنواع الجمل المرفوضة بالاسم. القايمة دي مش "الكلمات الخطيرة" — دي **كل** حاجة بره
 * `ALLOWED_STATEMENT_WORDS`، ومنها اللي ما اتفكّرش فيها أصلاً (`ALTER ROLE` بغيّر سقف الدور
 * لكل الجلسات الجاية، و`EXECUTE` بيشغّل معمّى سميته postgres.js في `pg_prepared_statements`،
 * و`GRANT` و`TRUNCATE` و`VACUUM` …).
 */
const REFUSED_WORDS: readonly (readonly [string, string])[] = [
  ["COMMIT", "COMMIT"],
  ["commit", "COMMIT"],
  ["COMMIT;", "COMMIT"],
  ["ROLLBACK", "ROLLBACK"],
  ["ROLLBACK TO SAVEPOINT s1", "ROLLBACK"],
  ["BEGIN", "BEGIN"],
  ["START TRANSACTION", "START"],
  ["END", "END"],
  ["ABORT", "ABORT"],
  ["SAVEPOINT s1", "SAVEPOINT"],
  ["RELEASE SAVEPOINT s1", "RELEASE"],
  ["PREPARE plan AS SELECT 1", "PREPARE"],
  ["EXECUTE plan", "EXECUTE"],
  ["DEALLOCATE plan", "DEALLOCATE"],
  ["SET statement_timeout = 0", "SET"],
  ["SET ROLE eyadex_platform", "SET"],
  ["RESET ALL", "RESET"],
  ["DISCARD ALL", "DISCARD"],
  ["DO $$ BEGIN END $$", "DO"],
  ["CALL some_procedure()", "CALL"],
  ["LOCK TABLE clinics", "LOCK"],
  ["LISTEN channel", "LISTEN"],
  ["NOTIFY channel", "NOTIFY"],
  ["UNLISTEN *", "UNLISTEN"],
  ["DECLARE c CURSOR FOR SELECT 1", "DECLARE"],
  ["FETCH 1 FROM c", "FETCH"],
  ["CLOSE c", "CLOSE"],
  ["GRANT SELECT ON patients TO eyadex_platform", "GRANT"],
  ["REVOKE SELECT ON patients FROM eyadex_app", "REVOKE"],
  ["ALTER ROLE eyadex_app SET statement_timeout = 0", "ALTER"],
  ["ALTER TABLE branches OWNER TO eyadex_app", "ALTER"],
  ["CREATE FUNCTION pg_temp.f() RETURNS void AS $$ SELECT 1 $$ LANGUAGE sql", "CREATE"],
  ["DROP TABLE branches", "DROP"],
  ["TRUNCATE patients", "TRUNCATE"],
  ["VACUUM", "VACUUM"],
  ["ANALYZE patients", "ANALYZE"],
  ["CHECKPOINT", "CHECKPOINT"],
  ["REINDEX TABLE branches", "REINDEX"],
  ["CLUSTER patients USING idx", "CLUSTER"],
  ["REFRESH MATERIALIZED VIEW m", "REFRESH"],
  ["COMMENT ON TABLE patients IS 'x'", "COMMENT"],
  ["EXPLAIN ANALYZE SELECT 1", "EXPLAIN"],
  ["COPY clinics TO STDOUT", "COPY"],
  ["LOAD 'lib'", "LOAD"],
];

describe("fn may only send one of the allowed statement kinds", () => {
  it("pins the allowed list, so a new kind is a deliberate change", () => {
    expect([...ALLOWED_STATEMENT_WORDS]).toEqual([
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "WITH",
      "VALUES",
      "TABLE",
      "MERGE",
    ]);
  });

  it.each(ALLOWED)("lets %j through", (statement) => {
    expect(forbiddenKeyword(statement)).toBeUndefined();
    expect(() => {
      assertStatementAllowed(statement);
    }).not.toThrow();
  });

  it.each(REFUSED_WORDS)("refuses %j and names %j", (statement, keyword) => {
    expect(forbiddenKeyword(statement)).toBe(keyword);
    expect(() => {
      assertStatementAllowed(statement);
    }).toThrow(ForbiddenStatementError);
  });

  it("accepts the allowed kinds in any case, because SQL keywords fold", () => {
    for (const statement of ["select 1", "insert into branches (id) values ($1)", "values (1)"]) {
      expect(forbiddenKeyword(statement)).toBeUndefined();
    }
  });

  it("refuses a word that only starts like an allowed one", () => {
    // `SELECTED` و`TABLESPACE` مش `SELECT` و`TABLE`: الكلمة كاملة، زي ما PostgreSQL بيفحص.
    expect(forbiddenKeyword("SELECTED 1")).toBe("SELECTED");
    expect(forbiddenKeyword("TABLESPACE x")).toBe("TABLESPACE");
  });
});

describe("there is no word to check, so there is nothing to send", () => {
  it.each([
    ["", "an empty string"],
    ["   \n\t\r\f\v", "PostgreSQL whitespace only"],
    ["-- just a comment", "a line comment with nothing after it"],
    ["/* just a comment */", "a block comment with nothing after it"],
    ["(((\n))", "parens and whitespace"],
    ["«SELECT 1", "a first word the guard cannot read as a plain keyword"],
  ])("refuses %j (%s)", (statement) => {
    expect(forbiddenKeyword(statement)).toBe(EMPTY_STATEMENT);
    expect(() => {
      assertStatementAllowed(statement);
    }).toThrow(ForbiddenStatementError);
  });

  it("names the refusal and lists what may be sent", () => {
    const failure = new ForbiddenStatementError(EMPTY_STATEMENT);
    expect(failure.message).toContain(
      "SELECT, INSERT, UPDATE, DELETE, WITH, VALUES, TABLE and MERGE",
    );
    expect(failure.message).toContain("ADR-0002");
    expect(failure.message).not.toContain("«");
  });
});

describe("a -- comment ends at a carriage return too", () => {
  // The PostgreSQL lexer rule is `newline [\n\r]`. Reading only `\n` left the rest of the text as
  // if it were still inside the comment, and the guard then ran on an empty body — which is
  // exactly how `sql.raw("--\rselect set_config(…)")` re-pointed the clinic.
  it("refuses a COMMIT hidden behind a CR-terminated comment", () => {
    // The comment now really ends at the `\r`, so the statement after it is read — and refused by
    // its kind. Before, the whole text looked like one comment and the guard read an empty body.
    expect(forbiddenKeyword("--\rCOMMIT")).toBe("COMMIT");
    expect(forbiddenKeyword("-- c\rCOMMIT AND SELECT 1")).toBe("COMMIT");
    expect(forbiddenKeyword("--\r")).toBe(EMPTY_STATEMENT);
    expect(() => {
      assertStatementAllowed("--\rSELECT set_config('app.clinic_id', 'other', true)");
    }).toThrow(ForbiddenStatementError);
  });

  it("refuses the CR variant of every smuggling shape", () => {
    for (const statement of [
      "--\rselect set_config('app.clinic_id', 'other', true)",
      "--\rCOMMIT",
      "--\rSET statement_timeout = 0",
      "-- c\rSELECT 1; COMMIT",
    ]) {
      expect(forbiddenKeyword(statement)).toBeDefined();
    }
  });

  it("still reads a statement after a CR-terminated comment", () => {
    expect(forbiddenKeyword("-- c\rSELECT 1")).toBeUndefined();
  });
});

describe("whitespace is PostgreSQL's, not JavaScript's", () => {
  it("treats a non-breaking space after `;` as content, not as padding", () => {
    // `\s` in JS eats U+00A0, `String.trim()` eats it too. PostgreSQL does not: it is a character
    // in the statement, so the second statement is really there.
    expect(forbiddenKeyword("SELECT 1;\u00a0COMMIT")).toBe(MULTIPLE_STATEMENTS);
    expect(forbiddenKeyword("SELECT 1;\u2028COMMIT")).toBe(MULTIPLE_STATEMENTS);
  });

  it("skips exactly the six whitespace characters PostgreSQL skips", () => {
    // The set is pinned, not inherited from JS: `\s` and `trim()` also eat NBSP and U+2028, which
    // PostgreSQL does not, so a `;` followed by NBSP is a second statement, not padding.
    for (const character of [" ", "\t", "\n", "\r", "\f", "\v"]) {
      expect(isWhitespace(character)).toBe(true);
    }
    for (const character of ["\u00a0", "\u2028", "\u2029", "\u3000", "\ufeff", "x"]) {
      expect(isWhitespace(character)).toBe(false);
    }
    expect(forbiddenKeyword("\u000b\u000c\t SELECT 1 \u000b")).toBeUndefined();
  });
});

describe("an unterminated block comment is refused", () => {
  it.each([
    "/* unterminated",
    "/* /* nested */ and then nothing",
    "SELECT 1 /* never closed",
    "-- c\n/* still open",
  ])("refuses %j", (statement) => {
    expect(forbiddenKeyword(statement)).toBe(UNTERMINATED_COMMENT);
    expect(() => {
      assertStatementAllowed(statement);
    }).toThrow(ForbiddenStatementError);
  });

  it("names the reason without quoting the statement", () => {
    const failure = new ForbiddenStatementError(UNTERMINATED_COMMENT);
    expect(failure.message).toContain("unterminated block comment");
    expect(failure.message).toContain("ADR-0002");
    expect(failure.message).not.toContain("/*");
  });
});

describe("a second statement in one call is refused", () => {
  it.each([
    "SELECT 1; COMMIT",
    "INSERT INTO branches (id) VALUES ('x'); COMMIT",
    "SELECT 1;\nCOMMIT",
    "SELECT 1; -- hidden commit\nCOMMIT",
    "SELECT 1;\rCOMMIT",
  ])("refuses %j", (statement) => {
    expect(forbiddenKeyword(statement)).toBe(MULTIPLE_STATEMENTS);
    expect(() => {
      assertStatementAllowed(statement);
    }).toThrow(ForbiddenStatementError);
  });

  it("allows a lone trailing semicolon — one statement, still one statement", () => {
    expect(forbiddenKeyword("SELECT 1;")).toBeUndefined();
    expect(forbiddenKeyword("SELECT 1;   ")).toBeUndefined();
    expect(forbiddenKeyword("SELECT ';'")).toBe(MULTIPLE_STATEMENTS);
  });

  it("names the rule without any of the SQL it read", () => {
    const failure = new ForbiddenStatementError(MULTIPLE_STATEMENTS);
    expect(failure).toBeInstanceOf(TypeError);
    expect(failure.name).toBe("ForbiddenStatementError");
    expect(failure.message).toMatch(/more than one statement/);
    expect(failure.message).not.toContain("COMMIT");
  });
});

describe("a keyword that is only named inside a comment is not a keyword", () => {
  it("reads the first word after the comments", () => {
    expect(forbiddenKeyword("-- never COMMIT or SET ROLE here\nSELECT 1")).toBeUndefined();
    expect(
      forbiddenKeyword("/* SET statement_timeout = 0 is the wrapper's job */ SELECT 1"),
    ).toBeUndefined();
  });
});

describe("the refusal message names the keyword and nothing else", () => {
  it("carries no SQL text, no parameters and no clinic ids", () => {
    const clinic = "01920000-0000-7000-8000-00000000abcd";
    for (const statement of [
      `SELECT set_config('app.clinic_id', '${clinic}', true)`,
      `SET statement_timeout = 0 /* ${clinic} */`,
      `ALTER ROLE eyadex_app SET statement_timeout = 0 /* ${clinic} */`,
    ]) {
      const keyword = forbiddenKeyword(statement);
      expect(keyword).toBeDefined();
      const failure = new ForbiddenStatementError(keyword ?? "COMMIT");
      expect(failure).toBeInstanceOf(TypeError);
      expect(failure.name).toBe("ForbiddenStatementError");
      for (const text of [failure.message, String(failure.stack), JSON.stringify(failure)]) {
        expect(text).not.toContain(clinic);
        expect(text).not.toContain("ALTER ROLE");
        expect(text).not.toContain("statement_timeout");
        expect(text).not.toContain("app.clinic_id");
        expect(text).not.toContain("'");
      }
    }
  });

  it("states the kind it refused, in upper case, and lists the allowed kinds", () => {
    expect(new ForbiddenStatementError("COMMIT").keyword).toBe("COMMIT");
    expect(new ForbiddenStatementError("COMMIT").message).toContain("COMMIT");
    expect(new ForbiddenStatementError("COMMIT").message).toMatch(/not one fn may send/);
    expect(new ForbiddenStatementError("ALTER").message).toContain(
      "SELECT, INSERT, UPDATE, DELETE, WITH, VALUES, TABLE and MERGE",
    );
  });
});
