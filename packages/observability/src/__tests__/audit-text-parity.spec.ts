import { describe, expect, it } from "vitest";

import { scrubAuditText, scrubAuditValue } from "../audit-text.ts";

// The two scrubs this one replaced (apps/api `shared/patient-audit-text.ts` on write, `modules/audit/
// domain/audit-text.ts` on read) each had a corpus. Every input of both runs here against the one
// function, plus the cases where the two disagreed, which now take the stricter answer.
// Synthetic values only: a fictional checksum-valid civil ID, 555/500-prefixed phones, all-zero runs.
const CIVIL_ID = "290040112347";
const PHONE = "55501234";
const ROLE = "0190a000-4000-7000-8000-000000000001";
const fullWidth = (digits: string) =>
  digits.replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)));
const arabicIndic = (digits: string) =>
  digits.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
const split = (digits: string, mark: string) => `${digits.slice(0, 6)}${mark}${digits.slice(6)}`;
const MARKS = [
  String.fromCharCode(0x200d),
  String.fromCharCode(0x202e, 0x2066, 0x2069),
  String.fromCharCode(0x00ad),
  String.fromCharCode(0xfeff),
  String.fromCharCode(0x0007),
];

const PATIENT_WRITE_CORPUS: readonly (readonly [string, string])[] = [
  [`Test${CIVIL_ID}`, "Test[REDACTED]"],
  [`Test ${fullWidth(CIVIL_ID)}`, "Test [REDACTED]"],
  [`مراجع${arabicIndic(CIVIL_ID)}`, "مراجع[REDACTED]"],
  [`Test ${CIVIL_ID.replace(/(\d{4})/g, "$1 ")}`, "Test [REDACTED] "],
  [`Test${PHONE}`, "Test***234"],
  [`Test${fullWidth(PHONE)}`, "Test***234"],
  [`Test${arabicIndic(PHONE)}`, "Test***234"],
  [`Test +965 ${PHONE}`, "Test ***234"],
  ...MARKS.map((mark) => [`Test${split(CIVIL_ID, mark)}`, "Test[REDACTED]"] as const),
  ...MARKS.map((mark) => [`Test${split(PHONE, mark)}`, "Test***234"] as const),
  ["Noura Al-Ali 3", "Noura Al-Ali 3"],
];

const AUDIT_READ_CORPUS: readonly (readonly [string, string])[] = [
  [
    "Sara +96500000005 300000000000 password=recognisable-fake-audit-password-321",
    "Sara ***005 [REDACTED] password=[REDACTED]",
  ],
  ["Sara Ahmad", "Sara Ahmad"],
  ["Zed 5000‍0006", "Zed ***006"],
  ["Zed 5000‎000‏7", "Zed ***007"],
  ["Zed 5000­00﻿08", "Zed ***008"],
  ["Zed ５００００００９", "Zed ***009"],
  ["عربي ٥٠٠٠٠٠١٠", "عربي ***010"],
  ["Zed ۵۰۰۰۰۰۱۱", "Zed ***011"],
  ["abc50000012xyz", "abc***012xyz"],
  ["Id 3000‌00000000", "Id [REDACTED]"],
  ["Id ３０００００００００００", "Id [REDACTED]"],
  ["50000001@example.test", "***001@example.test"],
  ["call 90000003 or 300000000000", "call ***003 or [REDACTED]"],
  ["Doctor 50000016", "Doctor ***016"],
  [ROLE, "0190a[REDACTED]"],
];

// Where the old scrubs disagreed: the write side left a 7-digit run, credential text and a tab; the
// read side caught all three. The one function catches them on both sides.
const STRICTER_THAN_ONE_OF_THEM: readonly (readonly [string, string])[] = [
  ["Test5550123", "Test***123"],
  ["Sara password=fake-hidden-value-9", "Sara password=[REDACTED]"],
  [`Test\t${PHONE}`, "Test ***234"],
];

// No run of 7 digits or more survives, whatever separates them.
const LONG_RUN = /\d(?:[\s.\-/()]*\d){6,}/;
const INVISIBLE = /[\p{Cf}\p{Cc}]/u;

describe("one audit scrub over both old corpora", () => {
  it.each([...PATIENT_WRITE_CORPUS, ...AUDIT_READ_CORPUS, ...STRICTER_THAN_ONE_OF_THEM])(
    "%j → %j",
    (input, expected) => {
      const out = scrubAuditText(input);
      expect(out).toBe(expected);
      expect(out).not.toMatch(LONG_RUN);
      expect(out).not.toMatch(INVISIBLE);
      // Written scrubbed, shown scrubbed again: the second pass changes nothing.
      expect(scrubAuditText(out)).toBe(out);
    },
  );

  it("keeps ids and instants only under their own keys, at any depth, array items included", () => {
    const shaped = `aaaaaaaa-aaaa-aaaa-aaaa-${CIVIL_ID}`;
    expect(
      scrubAuditValue({
        before: null,
        after: {
          id: shaped,
          patientId: ROLE,
          roleId: ROLE,
          branchIds: [ROLE],
          firstAdmin: { invitationId: ROLE, email: "60000002@example.test" },
          expiresAt: "2026-10-08T12:00:00.000Z",
          fullName: shaped,
          roleNameEn: ROLE,
          tags: [[shaped], [`y${PHONE}`]],
          fileNumber: 12,
          bigNumber: 50000016,
        },
      }),
    ).toEqual({
      before: null,
      after: {
        id: shaped,
        patientId: ROLE,
        roleId: ROLE,
        branchIds: [ROLE],
        firstAdmin: { invitationId: ROLE, email: "***002@example.test" },
        expiresAt: "2026-10-08T12:00:00.000Z",
        fullName: "aaaaaaaa-aaaa-aaaa-aaaa-[REDACTED]",
        roleNameEn: "0190a[REDACTED]",
        tags: [["aaaaaaaa-aaaa-aaaa-aaaa-[REDACTED]"], ["y***234"]],
        fileNumber: 12,
        bigNumber: "***016",
      },
    });
  });

  it("scrubs a malformed id or instant under a structured key as text", () => {
    expect(scrubAuditValue({ id: `x${CIVIL_ID}`, expiresAt: `soon ${PHONE}` })).toEqual({
      id: "x[REDACTED]",
      expiresAt: "soon ***234",
    });
  });

  it("withholds anything nested deeper than a snapshot ever is", () => {
    let deep: unknown = "Sara";
    for (let i = 0; i < 9; i++) deep = { level: deep };
    const out = JSON.stringify(scrubAuditValue(deep));
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("Sara");
  });
});
