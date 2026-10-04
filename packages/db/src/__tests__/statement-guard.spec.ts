import { describe, expect, it } from "vitest";

import { ForbiddenStatementError } from "../index.ts";
import { assertStatementAllowed, forbiddenKeyword } from "../statement-guard.ts";

/** جملة عادية: لازم تعدّي من غير ما الحارس يلمسها. */
const ALLOWED = [
  "SELECT 1",
  "SELECT id FROM patients WHERE clinic_id = current_clinic()",
  "UPDATE branches SET name_ar = 'فرع' WHERE id = $1",
  "DELETE FROM invitations WHERE id = $1 RETURNING id",
  // CTE: الكلمة الأولى WITH، وWITH مش من كلمات التحكم
  "WITH x AS (SELECT 1 AS n) SELECT n FROM x",
  // جملة ملفوفة في أقواس: أول قوس بيتقفل قبل SELECT، فـ SELECT هي أول كلمة
  "((( SELECT 1 ), ( SELECT 2 ))",
  // INSERT … RETURNING: زي CTE، مفيش كلمة تحكم في الأول
  "INSERT INTO branches (clinic_id, id) VALUES ($1, $2) RETURNING id",
  // كلمة بتبدأ بحرف من كلمة ممنوعة مش هي
  "SELECT settle FROM settings",
  "SELECT * FROM endpoints WHERE note = 'SETTINGS'",
];

const REFUSED: readonly (readonly [string, string])[] = [
  ["COMMIT", "COMMIT"],
  ["commit", "COMMIT"],
  ["COMMIT;", "COMMIT"],
  ["ROLLBACK", "ROLLBACK"],
  ["BEGIN", "BEGIN"],
  ["START TRANSACTION", "START"],
  ["END", "END"],
  ["ABORT", "ABORT"],
  ["SAVEPOINT s1", "SAVEPOINT"],
  ["RELEASE SAVEPOINT s1", "RELEASE"],
  ["PREPARE plan AS SELECT 1", "PREPARE"],
  ["SET statement_timeout = 0", "SET"],
  ["RESET ALL", "RESET"],
  ["DISCARD ALL", "DISCARD"],
  ["DO $$ BEGIN END $$", "DO"],
  ["CALL some_procedure()", "CALL"],
  ["LOCK TABLE clinics", "LOCK"],
  ["LISTEN channel", "LISTEN"],
  ["UNLISTEN *", "UNLISTEN"],
  ["LOAD 'lib'", "LOAD"],
  ["COPY clinics TO STDOUT", "COPY"],
];

describe("the statement guard refuses the statements that own the transaction", () => {
  it.each(REFUSED)("refuses %j as %j", (statement, keyword) => {
    expect(forbiddenKeyword(statement)).toBe(keyword);
    expect(() => {
      assertStatementAllowed(statement);
    }).toThrow(ForbiddenStatementError);
  });

  it("sees through leading whitespace, line comments, block comments and parens", () => {
    // Comments and the opening paren of a wrapped sub-select are exactly how a caller would try to
    // hide the first keyword, so the guard reads past them.
    for (const statement of [
      "  \n\t COMMIT",
      "-- a helpful note\nrollback;",
      "/* x */ SET statement_timeout = 0",
      "/* a /* nested */ still a comment */ RESET ALL",
      "/* c1 */ /* c2 */ -- c3\n SAVEPOINT s1",
    ]) {
      expect(forbiddenKeyword(statement)).toBeDefined();
    }
  });

  it("does not read a keyword that is only inside a comment", () => {
    // A comment may NAME the forbidden words — that is documentation, not a statement.
    expect(forbiddenKeyword("-- never COMMIT or SET ROLE here\nSELECT 1")).toBeUndefined();
    expect(forbiddenKeyword("/* SET statement_timeout = 0 is the wrapper's job */ SELECT 1")).toBe(
      undefined,
    );
  });
});

describe("set_config is refused wherever it appears", () => {
  it.each([
    "SELECT set_config('app.clinic_id', $1, true)",
    "SELECT SET_CONFIG('app.clinic_id', $1, false)",
    // the clinic re-point + restore pair, in one statement
    "SELECT set_config('app.clinic_id', $1, true), set_config('app.clinic_id', $2, true)",
    // an assignment form, which the first-word check would miss on its own
    "SELECT 1 FROM set_config('app.clinic_id', $1, true)",
  ])("refuses %j", (statement) => {
    expect(forbiddenKeyword(statement)).toBe("set_config");
  });

  it("fails closed on a literal that merely contains the word", () => {
    // This is a false positive by design: refusing one harmless query is cheaper than letting a
    // substring smuggle set_config through (ADR-0002, "fails closed").
    const falsePositive = "SELECT 'set_config'::text AS note";
    expect(forbiddenKeyword(falsePositive)).toBe("set_config");
    expect(() => {
      assertStatementAllowed(falsePositive);
    }).toThrow(ForbiddenStatementError);
  });
});

describe("a second statement in one call is refused", () => {
  it.each([
    "SELECT 1; COMMIT",
    "INSERT INTO branches (id) VALUES ('x'); COMMIT",
    "SELECT 1;\nCOMMIT",
    "SELECT 1; -- hidden commit\nCOMMIT",
  ])("refuses %j", (statement) => {
    expect(forbiddenKeyword(statement)).toBe("multiple statements");
    expect(() => {
      assertStatementAllowed(statement);
    }).toThrow(ForbiddenStatementError);
  });

  it("allows a lone trailing semicolon — one statement, still one statement", () => {
    expect(forbiddenKeyword("SELECT 1;")).toBeUndefined();
    expect(forbiddenKeyword("SELECT 1;   ")).toBeUndefined();
    expect(forbiddenKeyword("SELECT ';'")).toBe("multiple statements");
  });

  it("names the rule without any of the SQL it read", () => {
    const failure = new ForbiddenStatementError("multiple statements");
    expect(failure).toBeInstanceOf(TypeError);
    expect(failure.name).toBe("ForbiddenStatementError");
    expect(failure.message).toMatch(/more than one statement/);
    expect(failure.message).not.toContain("COMMIT");
  });
});

describe("ordinary work is untouched", () => {
  it.each(ALLOWED)("lets %j through", (statement) => {
    expect(forbiddenKeyword(statement)).toBeUndefined();
    expect(() => {
      assertStatementAllowed(statement);
    }).not.toThrow();
  });
});

describe("the refusal message names the keyword and nothing else", () => {
  it("carries no SQL text, no parameters and no clinic ids", () => {
    const clinic = "01920000-0000-7000-8000-00000000abcd";
    for (const statement of [
      `SELECT set_config('app.clinic_id', '${clinic}', true)`,
      `SET statement_timeout = 0 /* ${clinic} */`,
    ]) {
      const failure = new ForbiddenStatementError(forbiddenKeyword(statement) ?? "COMMIT");
      expect(failure).toBeInstanceOf(TypeError);
      expect(failure.name).toBe("ForbiddenStatementError");
      expect(failure.message).not.toContain(clinic);
      expect(failure.message).not.toContain("SELECT");
      expect(failure.message).not.toContain("app.clinic_id");
      expect(failure.message).not.toContain("'");
      for (const text of [failure.message, String(failure.stack), JSON.stringify(failure)]) {
        expect(text).not.toContain(clinic);
      }
    }
  });

  it("states the keyword it refused, in upper case for the control words", () => {
    expect(new ForbiddenStatementError("COMMIT").keyword).toBe("COMMIT");
    expect(new ForbiddenStatementError("COMMIT").message).toContain("COMMIT");
    expect(new ForbiddenStatementError("set_config").message).toContain("set_config");
    // the two reasons read differently, because they are different problems
    expect(new ForbiddenStatementError("COMMIT").message).toMatch(/one call runs exactly one/);
    expect(new ForbiddenStatementError("set_config").message).toMatch(/only way a statement can/);
  });
});
