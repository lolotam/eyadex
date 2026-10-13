import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM: authenticated, so a tampered or moved ciphertext fails to open. The `context` is bound
// as additional data (the outbox event id), so a sealed value copied into another event never opens.
const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
// GCM accepts tags as short as 4 bytes unless told otherwise; a truncated tag would weaken the check.
const TAG_BYTES = 16;

/** فشل فتح الختم؛ لا يحمل القيمة المختومة ولا خطأ التشفير الأصلي. */
export class SealOpenError extends Error {
  constructor() {
    super("sealed value cannot be opened");
    this.name = "SealOpenError";
  }
}

/**
 * بيقفل سر قصير (رمز الدعوة) بمفتاح مع الـ API والـ worker بس، عشان يعدّي على الـ outbox من غير ما
 * الداتابيز تشيله مكشوف (ADR-0006). بيستخدمه الـ API (بيقفل) والـ worker (بيفتح وقت الإرسال، ADR-0013).
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
      throw new SealOpenError();
    }
    const authTag = Buffer.from(tag, "base64url");
    if (authTag.length !== TAG_BYTES) throw new SealOpenError();
    try {
      const decipher = createDecipheriv(ALGORITHM, this.#key, Buffer.from(iv, "base64url"), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(Buffer.from(body, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new SealOpenError();
    }
  }
}
