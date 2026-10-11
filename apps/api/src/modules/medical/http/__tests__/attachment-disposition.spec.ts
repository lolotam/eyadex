import { describe, expect, it } from "vitest";

import { attachmentDisposition } from "../attachments.controller.ts";

// RFC 6266: a download's name in both forms, and nothing in a name can end or add a header.
describe("attachmentDisposition", () => {
  it("gives an ASCII fallback and the exact UTF-8 name", () => {
    const value = attachmentDisposition("تحليل (1).pdf");
    expect(value).toMatch(/^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''/);
    expect(decodeURIComponent(value.split("UTF-8''")[1]!)).toBe("تحليل (1).pdf");
    expect(value).toContain("%281%29");
    expect(attachmentDisposition("lab.pdf")).toBe(
      `attachment; filename="lab.pdf"; filename*=UTF-8''lab.pdf`,
    );
  });

  it("NEGATIVE: quotes, backslashes, CR and LF never reach the header raw", () => {
    const value = attachmentDisposition("a\"b\\c\r\nSet-Cookie: x=1'.png");
    expect(value).not.toMatch(/[\r\n]/);
    const fallback = /filename="([^"]*)"/.exec(value)![1]!;
    expect(fallback).toBe("a_b_c__Set-Cookie: x=1'.png");
    expect(value.split("UTF-8''")[1]).not.toMatch(/['"\\ ]/);
  });
});
