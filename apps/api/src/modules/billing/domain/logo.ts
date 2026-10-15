/** أكبر حجم للوجو (spec §3.3): 1 ميجا. */
export const LOGO_MAX_BYTES = 1024 * 1024;

export type LogoType = "image/png" | "image/jpeg";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

/**
 * نوع الصورة من أول بايتاتها، مش من الاسم ولا من الـ header اللي العميل بعته.
 *
 * @param bytes الملف
 * @returns `image/png` أو `image/jpeg`، أو `null` لو مش واحدة منهم
 */
export function logoType(bytes: Buffer): LogoType | null {
  if (bytes.subarray(0, PNG.length).equals(PNG)) return "image/png";
  if (bytes.subarray(0, JPEG.length).equals(JPEG)) return "image/jpeg";
  return null;
}
