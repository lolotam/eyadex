import { describe, expect, it } from "vitest";
import { acceptedAttachmentType, sniffAttachmentType } from "./attachment-type";

// The cases of the API's `domain/__tests__/attachment-rules.spec.ts`: the copy must sniff the same.
const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF");
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "IHDR");
const WEBP = bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ");
const PDF = bytes("%PDF-1.7\n");

describe("sniffAttachmentType", () => {
  it.each([
    ["image/jpeg", JPEG],
    ["image/png", PNG],
    ["image/webp", WEBP],
    ["application/pdf", PDF],
  ])("knows %s by its first bytes", (type, content) => {
    expect(sniffAttachmentType(content)).toBe(type);
  });

  it.each([
    ["anything else", bytes("<html>")],
    ["a RIFF that is not WebP", bytes("RIFF", [0, 0, 0, 0], "WAVE")],
    ["a cut signature", PNG.subarray(0, 7)],
    ["nothing", new Uint8Array(0)],
  ])("NEGATIVE: %s is null", (_case, content) => {
    expect(sniffAttachmentType(content)).toBeNull();
  });
});

describe("acceptedAttachmentType", () => {
  it.each([
    ["image/png", PNG],
    ["application/pdf", PDF],
  ])("accepts %s that the content matches", (type, content) => {
    expect(acceptedAttachmentType(type, content)).toBe(type);
  });

  it.each([
    ["a PNG declared as a PDF", "application/pdf", PNG],
    ["a type off the list", "text/html", bytes("<html>")],
    ["a GIF", "image/gif", bytes("GIF89a")],
    ["a WebP declared as a JPEG", "image/jpeg", WEBP],
  ])("NEGATIVE: refuses %s", (_case, declared, content) => {
    expect(acceptedAttachmentType(declared, content)).toBeNull();
  });
});
