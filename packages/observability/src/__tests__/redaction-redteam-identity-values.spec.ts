import { describe, expect, it } from "vitest";

import { REDACTED, sanitize } from "../redaction.ts";

// CLASS 3 / 4 / 6 / 7 / 8 from the red-team report: patient identity, non-string values, Unicode
// obfuscation and phone formats. All of these are log-mode rules unless noted.

describe("CLASS 3 — patient identity under neutral or metadata keys", () => {
  it.each([
    ["clientName", "أحمد محمد"],
    ["genderCode", 1],
    ["genderLabel", "male"],
    ["sex", "male"],
    ["sexLabel", "male"],
    ["Sex", "male"],
    ["addressLine1", "Block 5, Street 10"],
    ["streetAddress", "Salmiya"],
    ["nationalityCode", "KW"],
    ["passport", "P1234567"],
    ["displayName", "أحمد محمد"],
    ["ownerName", "أحمد محمد"],
    ["motherName", "أحمد محمد"],
    ["fatherName", "أحمد محمد"],
    ["spouseName", "أحمد محمد"],
    ["emergencyContactName", "أحمد محمد"],
    ["referringDoctorName", "أحمد محمد"],
    ["maritalStatus", "married"],
  ])("redacts the identity field %s", (key, value) => {
    expect(sanitize({ row: { [key]: value } })).toEqual({ row: { [key]: REDACTED } });
  });

  it("redacts an Arabic (entirely non-ASCII) key in log mode", () => {
    expect(sanitize({ اسم_العميل: "محمد علي" })).toEqual({ اسم_العميل: REDACTED });
    expect(sanitize({ الجنسية: "الكويت" })).toEqual({ الجنسية: REDACTED });
  });

  it("redacts a bare name, but keeps the structural name fields", () => {
    // Rule 3: "name" is patient identity now; the technical spellings are exempted explicitly instead of
    // the whole rule being omitted — the route/event names must still survive.
    expect(sanitize({ row: { name: "أحمد محمد" } })).toEqual({ row: { name: REDACTED } });
    expect(sanitize({ name: "أحمد محمد" })).toEqual({ name: REDACTED });
    expect(sanitize({ m: new Map([["name", "أحمد محمد"]]) })).toEqual({ m: { name: REDACTED } });
    expect(sanitize({ routeName: "patients.list", eventName: "PatientRegistered" })).toEqual({
      routeName: "patients.list",
      eventName: "PatientRegistered",
    });
    expect(
      sanitize({
        filename: "x.log",
        hostname: "db.example",
        columnName: "id",
        methodName: "GET",
        fieldName: "amount",
      }),
    ).toEqual({
      filename: "x.log",
      hostname: "db.example",
      columnName: "id",
      methodName: "GET",
      fieldName: "amount",
    });
  });
});

describe("CLASS 4 — non-string values", () => {
  it("scans a number and a bigint like their decimal string", () => {
    expect(sanitize({ reference: 300000000000 })).toEqual({ reference: REDACTED });
    expect(sanitize({ reference: 300000000000n })).toEqual({ reference: REDACTED });
    expect(sanitize({ contact: 50012345 })).toEqual({ contact: "***345" });
  });

  it("keeps a plain date value (accepted risk — see the ADR)", () => {
    expect(sanitize({ startedAt: "1990-01-01" })).toEqual({ startedAt: "1990-01-01" });
  });
});

describe("CLASS 6 — Unicode-obfuscated keys", () => {
  it("folds a full-width key and redacts it", () => {
    expect(sanitize({ ｔｏｋｅｎ: "tok_live_x" })).toEqual({ ｔｏｋｅｎ: REDACTED });
  });

  it("redacts an Arabic password key via the non-ASCII rule", () => {
    expect(sanitize({ كلمة_المرور: "hunter2" })).toEqual({ كلمة_المرور: REDACTED });
  });
});

describe("CLASS 7 — Unicode-obfuscated values", () => {
  it.each([
    ["full-width phone", "call ５００１２３４５ now", "call ***345 now"],
    ["full-width civil ID", "id ３０００４０１１２３４７ x", `id ${REDACTED} x`],
    ["zero-width joiner in a phone", "call 5001\u200D2345 now", "call ***345 now"],
    ["RTL mark in a phone", "call 5001\u200F2345 now", "call ***345 now"],
    ["zero-width joiner in a civil ID", "id 3000\u200D40112347", `id ${REDACTED}`],
  ])("handles %s", (_label, raw, expected) => {
    expect(sanitize({ note: raw })).toEqual({ note: expected });
  });
});

describe("CLASS 8 — phone formats", () => {
  it.each([
    ["dot", "call 5001.2345 now", "call ***345 now"],
    ["slash", "call 5001/2345 now", "call ***345 now"],
    ["parentheses", "call (5001)2345 now", "call ***345 now"],
    ["bracketed country code", "call (+965) 5001 2345 now", "call ***345 now"],
    ["generic international (US)", "call +1 555 123 4567 now", "call ***567 now"],
    ["generic international (UK)", "call +44-20-7946-0958 now", "call ***958 now"],
  ])("masks a %s number", (_label, raw, expected) => {
    expect(sanitize({ note: raw })).toEqual({ note: expected });
  });

  it.each([
    "01a10256-8025-770a-a401-f765af7fa409",
    "2026-10-03T16:06:00.230Z",
    "invoice 123456789",
    "ref 12345678",
    "took 250 ms",
    "order 123456789012",
  ])("leaves %j alone", (raw) => {
    expect(sanitize({ note: raw })).toEqual({ note: raw });
  });
});
