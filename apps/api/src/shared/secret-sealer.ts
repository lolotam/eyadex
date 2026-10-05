import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM: authenticated, so a tampered or moved ciphertext fails to open. The `context` is bound
// as additional data (the outbox event id), so a sealed value copied into another event never opens.
const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

/**
 * بيقفل سر قصير (رمز الدعوة) بمفتاح مع الـ API والـ worker بس، عشان يعدّي على الـ outbox من غير ما
 * الداتابيز تشيله مكشوف (ADR-0006). TODO(spec): يتنقل لـ package مشترك مع slice الـ worker.
 */
export class SecretSealer {
  readonly #key: Buffer;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, "base64");
    if (key.length !== 32) throw new TypeError("OUTBOX_SEAL_KEY must be 32 bytes, base64-encoded");
    this.#key = key;
  }

  /**
   * بيقفل القيمة ومربوطة بالسياق.
   *
   * @param value السر
   * @param context السياق المربوط (مثلاً id الحدث)
   * @returns `v1.<iv>.<ciphertext>.<tag>` بـ base64url
   */
  seal(value: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.#key, iv);
    cipher.setAAD(Buffer.from(context, "utf8"));
    const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [VERSION, iv, body, cipher.getAuthTag()]
      .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
      .join(".");
  }

  /**
   * بيفتح قيمة اتقفلت بنفس المفتاح ونفس السياق؛ أي تلاعب بيرمي خطأ.
   *
   * @param sealed ناتج `seal`
   * @param context نفس السياق
   * @returns السر
   */
  open(sealed: string, context: string): string {
    const [version, iv, body, tag] = sealed.split(".");
    if (version !== VERSION || iv === undefined || body === undefined || tag === undefined) {
      throw new TypeError("not a sealed value");
    }
    const decipher = createDecipheriv(ALGORITHM, this.#key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}
