import { ATTACHMENT_TYPES, type Attachment } from "@eyadex/contracts/attachments";

/** نوع مرفق مسموح (P2-10): jpeg أو png أو webp أو pdf. */
export type AttachmentType = Attachment["contentType"];

const NAME_MAX = 255;
const FALLBACK_NAME = "attachment";

// The first bytes of each allowed type. WebP is a RIFF container: "RIFF", four size bytes, then "WEBP".
const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

/**
 * نوع الملف من أول بايتات فيه، مش من اسمه ولا من النوع اللي العميل قاله.
 *
 * @param bytes محتوى الملف
 * @returns النوع المسموح اللي البايتات بتطابقه، أو `null`
 */
export function sniffAttachmentType(bytes: Uint8Array): AttachmentType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  if (startsWith(bytes, ascii("%PDF-"))) return "application/pdf";
  return null;
}

/**
 * P2-10: النوع اللي العميل قاله لازم يكون من الأربعة المسموحة **و**يطابق محتوى الملف، فصورة PNG اسمها
 * `.pdf` أو نوعها متغيّر بتترفض.
 *
 * @param declared نوع الجزء في الـ multipart
 * @param bytes محتوى الملف
 * @returns النوع، أو `null` = `attachment_type`
 */
export function acceptedAttachmentType(declared: string, bytes: Uint8Array): AttachmentType | null {
  const allowed = (ATTACHMENT_TYPES as readonly string[]).includes(declared);
  const sniffed = sniffAttachmentType(bytes);
  return allowed && sniffed === declared ? sniffed : null;
}

/**
 * اسم الملف زي ما هيتشفّر ويتعرض: من غير مسار ولا حروف تحكم، 255 حرف بالكتير، ومش فاضي.
 *
 * @param raw الاسم اللي جه مع الملف
 * @returns الاسم النضيف
 */
export function attachmentName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed here
  const clean = base.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, "");
  const trimmed = [...clean.trim()].slice(0, NAME_MAX).join("");
  return trimmed === "" ? FALLBACK_NAME : trimmed;
}

/**
 * مكان المرفق في المخزن: العيادة والمرفق بس، من غير اسم ملف ولا بيانات مراجع (0049 بيتأكد منه).
 *
 * @param clinicId العيادة
 * @param attachmentId المرفق
 * @returns `clinic/<clinicId>/<attachmentId>`
 */
export function attachmentStorageKey(clinicId: string, attachmentId: string): string {
  return `clinic/${clinicId}/${attachmentId}`;
}
