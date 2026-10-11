// A copy of the API's `sniffAttachmentType` and `acceptedAttachmentType` in
// `apps/api/src/modules/medical/domain/attachment-rules.ts` (P2-10), so the mock refuses exactly the
// uploads the API refuses; change both together (`attachment-type.test.ts` runs the API spec's cases).
import { ATTACHMENT_TYPES, type Attachment } from "@eyadex/contracts/attachments";

/** An allowed attachment type (P2-10): jpeg, png, webp or pdf. */
export type AttachmentType = Attachment["contentType"];

/** How many leading bytes the signatures read (WebP's "WEBP" ends at the twelfth). */
export const SIGNATURE_LENGTH = 12;

// The first bytes of each allowed type. WebP is a RIFF container: "RIFF", four size bytes, then "WEBP".
const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

/** The allowed type the leading bytes match, never the name or the declared type; else `null`. */
export function sniffAttachmentType(bytes: Uint8Array): AttachmentType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, ascii("%PDF-"))) return "application/pdf";
  return null;
}

/** The declared type, when it is one of the four **and** the content matches it; `null` = `attachment_type`. */
export function acceptedAttachmentType(declared: string, bytes: Uint8Array): AttachmentType | null {
  const allowed = (ATTACHMENT_TYPES as readonly string[]).includes(declared);
  const sniffed = sniffAttachmentType(bytes);
  return allowed && sniffed === declared ? sniffed : null;
}
