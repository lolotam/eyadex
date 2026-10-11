import { describe, expect, it } from "vitest";

import {
  acceptedAttachmentType,
  attachmentName,
  sniffAttachmentType,
} from "../attachment-rules.ts";

const bytes = (...parts: (number[] | string)[]) =>
  Buffer.concat(
    parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))),
  );

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF");
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "IHDR");
const WEBP = bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ");
const PDF = bytes("%PDF-1.7\n");

describe("sniffAttachmentType (P2-10)", () => {
  it("knows each allowed type by its first bytes", () => {
    expect(sniffAttachmentType(JPEG)).toBe("image/jpeg");
    expect(sniffAttachmentType(PNG)).toBe("image/png");
    expect(sniffAttachmentType(WEBP)).toBe("image/webp");
    expect(sniffAttachmentType(PDF)).toBe("application/pdf");
  });

  it("NEGATIVE: anything else, a RIFF that is not WebP, a cut signature or nothing is null", () => {
    expect(sniffAttachmentType(bytes("<html>"))).toBeNull();
    expect(sniffAttachmentType(bytes("RIFF", [0, 0, 0, 0], "WAVE"))).toBeNull();
    expect(sniffAttachmentType(PNG.subarray(0, 7))).toBeNull();
    expect(sniffAttachmentType(Buffer.alloc(0))).toBeNull();
  });
});

describe("acceptedAttachmentType", () => {
  it("accepts a declared type that the content matches", () => {
    expect(acceptedAttachmentType("image/png", PNG)).toBe("image/png");
    expect(acceptedAttachmentType("application/pdf", PDF)).toBe("application/pdf");
  });

  it("NEGATIVE: a PNG declared as a PDF, a type off the list, or a mismatch is refused", () => {
    expect(acceptedAttachmentType("application/pdf", PNG)).toBeNull();
    expect(acceptedAttachmentType("text/html", bytes("<html>"))).toBeNull();
    expect(acceptedAttachmentType("image/gif", bytes("GIF89a"))).toBeNull();
    expect(acceptedAttachmentType("image/jpeg", WEBP)).toBeNull();
  });
});

describe("attachmentName", () => {
  it("keeps the base name without path, control or direction characters, at most 255 characters", () => {
    expect(attachmentName("C:\\scans\\تحليل.pdf")).toBe("تحليل.pdf");
    expect(attachmentName("../../etc/passwd")).toBe("passwd");
    expect(attachmentName(" a\r\nb\u202e.png ")).toBe("ab.png");
    expect([...attachmentName("ع".repeat(300))]).toHaveLength(255);
  });

  it("names an empty or blank file `attachment`", () => {
    expect(attachmentName("")).toBe("attachment");
    expect(attachmentName("  \t")).toBe("attachment");
    expect(attachmentName("dir/")).toBe("attachment");
  });
});
