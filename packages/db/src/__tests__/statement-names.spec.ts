import { describe, expect, it } from "vitest";

import { ForbiddenStatementError } from "../index.ts";
import {
  assertStatementAllowed,
  forbiddenKeyword,
  TEXT_EXECUTING_FUNCTIONS,
  UNICODE_ESCAPE_KEYWORD,
} from "../statement-guard.ts";

/**
 * الفحوصات اللي بتتم على **النص الخام** مش على الـ body المنزوع التعليقات. دي اللي كانت بتتنزلق
 * في الجولات اللي فاتت: `set_config` جوه comment كان يعدّي لأن الفحص كان على الـ body، و
 * `U&"set\005fconfig"` كان يعدّي لأن الحروف نفسها مش في النص، و
 * `query_to_xml('select set_' || 'config(…)')` كان يعدّي لأن الاسم متكوّن من نصين.
 */
describe("set_config is refused wherever it appears", () => {
  it.each([
    "SELECT set_config('app.clinic_id', $1, true)",
    "SELECT SET_CONFIG('app.clinic_id', $1, false)",
    // the clinic re-point + restore pair, in one statement
    "SELECT set_config('app.clinic_id', $1, true), set_config('app.clinic_id', $2, true)",
    // an assignment form, which the first-word check would miss on its own
    "SELECT 1 FROM set_config('app.clinic_id', $1, true)",
    // quoted identifiers spell the same name and stay refused by the name check
    `SELECT "set_config"('app.clinic_id', $1, true)`,
    `SELECT pg_catalog."SET_CONFIG"('statement_timeout', '0', true)`,
  ])("refuses %j", (statement) => {
    expect(forbiddenKeyword(statement)).toBe("set_config");
    expect(() => {
      assertStatementAllowed(statement);
    }).toThrow(ForbiddenStatementError);
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

  it("fails closed inside a comment too — the name check reads the raw text", () => {
    // The body after `-- ` is empty, so a body-only check would have read "nothing to check".
    expect(forbiddenKeyword("-- never write set_config here\nSELECT 1")).toBe("set_config");
  });
});

describe("U& identifiers and strings are refused whole", () => {
  // PostgreSQL accepts `U&"…"` and `U&'…'` with `\XXXX` / `\+XXXXXX` escapes, so the name of a
  // forbidden function can be spelled without showing a single one of its letters.
  it.each([
    `SELECT pg_catalog.U&"set\\005fconfig"('app.clinic_id', $1, true)`,
    `SELECT u&"x" FROM t`,
    `SELECT U&'\\0063ommit'`,
    // the check comes first, so this is U& and not the literal
    `SELECT 'set_config' = U&'x'`,
    `SELECT U&"\\0041" , set_config('app.clinic_id', $1, true)`,
  ])("refuses %j", (statement) => {
    expect(forbiddenKeyword(statement)).toBe(UNICODE_ESCAPE_KEYWORD);
    expect(() => {
      assertStatementAllowed(statement);
    }).toThrow(ForbiddenStatementError);
  });

  it("names the keyword in the message, without the text", () => {
    const failure = new ForbiddenStatementError(UNICODE_ESCAPE_KEYWORD);
    expect(failure).toBeInstanceOf(TypeError);
    expect(failure.keyword).toBe("U&");
    expect(failure.message).toContain("U&");
    expect(failure.message).toContain("ADR-0002");
    expect(failure.message).not.toContain("SELECT");
  });
});

describe("functions that run SQL given as text are refused", () => {
  it("pins the list, so a new one is a deliberate change", () => {
    expect([...TEXT_EXECUTING_FUNCTIONS]).toEqual([
      "query_to_xml",
      "query_to_xmlschema",
      "query_to_xml_and_xmlschema",
      "cursor_to_xml",
      "cursor_to_xmlschema",
      "ts_stat",
      "ts_rewrite",
    ]);
  });

  it.each([...TEXT_EXECUTING_FUNCTIONS])("refuses %j wherever it appears", (functionName) => {
    for (const statement of [
      `SELECT ${functionName}('select 1', true, false, '')`,
      `SELECT pg_catalog.${functionName.toUpperCase()}('commit', true, false, '')`,
      `SELECT 1 FROM clinics WHERE name = '${functionName}'`,
    ]) {
      expect(forbiddenKeyword(statement)).toBe(functionName);
    }
  });

  it("refuses the query_to_xml split-name attempt, where no forbidden word is spelled out", () => {
    // The red-team form: the name is built from two string literals, so neither the `set_config`
    // check nor a first-word check can see it — the executed query is still the forbidden one.
    const smuggled = `SELECT query_to_xml('select set_' || 'config(''app.clinic_id'', ' ||
      quote_literal($1) || ', true)', true, false, '')`;
    expect(smuggled).not.toContain("set_config");
    expect(forbiddenKeyword(smuggled)).toBe("query_to_xml");
  });

  it("refuses the ts_stat attempt that changed statement_timeout the same way", () => {
    const smuggled = `SELECT ts_stat('select set_' || 'config(''statement_timeout'', ''0'', true)')`;
    expect(smuggled).not.toContain("set_config");
    expect(forbiddenKeyword(smuggled)).toBe("ts_stat");
  });

  it("names the function in the message, and nothing of the statement", () => {
    const clinic = "01920000-0000-7000-8000-00000000abcd";
    const statement = `SELECT query_to_xml('select set_config(''app.clinic_id'', '${clinic}', true)')`;
    const keyword = forbiddenKeyword(statement);
    expect(keyword).toBe("set_config");
    const viaFunction = new ForbiddenStatementError("query_to_xml");
    expect(viaFunction.message).toContain("query_to_xml");
    expect(viaFunction.message).toContain("ADR-0002");
    for (const text of [viaFunction.message, String(viaFunction.stack)]) {
      expect(text).not.toContain(clinic);
      expect(text).not.toContain("SELECT");
    }
  });
});
