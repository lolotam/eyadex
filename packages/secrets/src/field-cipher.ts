import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// AES-256-GCM with a per-clinic key (ADR-0028). The key is never used as is: each clinic gets its own
// HKDF-derived key, so one clinic's ciphertext never opens under another clinic's key even before the
// additional data is checked.
const ALGORITHM = "aes-256-gcm";
const PREFIX = "f1";
const IV_BYTES = 12;
// GCM accepts tags as short as 4 bytes unless told otherwise; a truncated tag would weaken the check.
const TAG_BYTES = 16;
const FIELD_INFO = "eyadex-field";
const KEY_BYTES = 32;
// R2-9: exactly the 44 characters of 32 bytes in standard base64 — no URL alphabet, no stray character.
const KEY_SHAPE = /^[A-Za-z0-9+/]{43}=$/;

/** مكان القيمة المشفّرة: الجدول والعمود وصف القيمة نفسها (الـ additional data، ADR-0028). */
export interface FieldRef {
  readonly table: string;
  readonly column: string;
  readonly rowId: string;
}

const additionalData = (clinicId: string, ref: FieldRef): Buffer =>
  Buffer.from(`${ref.table}:${ref.column}:${clinicId}:${ref.rowId}`, "utf8");

/**
 * مفتاح مشتق لعيادة واحدة واستخدام واحد (HKDF-SHA256، الملح = id العيادة).
 *
 * @param master المفتاح الرئيسي (32 بايت)
 * @param clinicId العيادة
 * @param info الاستخدام (`eyadex-field` أو `eyadex-civil-id`)
 * @returns مفتاح 32 بايت
 */
export function deriveClinicKey(master: Buffer, clinicId: string, info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.from(clinicId, "utf8"), info, KEY_BYTES));
}

/**
 * خطأ إعداد مفتاح: بيشيل اسم المتغيّر والسبب كحقول منفصلة، عشان اللي بيسجّل الخطأ يطبع الاسم من غير ما
 * يثق في نص الرسالة. لسه TypeError عشان أي حد بيمسك TypeError يفضل شغال.
 */
export class KeyConfigError extends TypeError {
  readonly variable: string;
  readonly reason: string;

  /**
   * @param variable اسم المتغيّر، عمره ما يكون قيمته
   * @param reason السبب، نص ثابت من الكود
   */
  constructor(variable: string, reason: string) {
    super(`${variable} ${reason}`);
    this.variable = variable;
    this.reason = reason;
  }
}

/**
 * بيقبل المفتاح بس لو Base64 سليم بالظبط و32 بايت (R2-9)، عشان مفتاح متقصّ أو فيه حرف زيادة مايعدّيش.
 * الخطأ بيسمّي المتغيّر بس، عمره ما بيطبع القيمة.
 *
 * @param name اسم المتغيّر (للخطأ)
 * @param value القيمة
 * @returns المفتاح
 */
export function strictKey(name: string, value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (!KEY_SHAPE.test(value) || key.length !== KEY_BYTES || key.toString("base64") !== value) {
    throw new KeyConfigError(name, "must be 32 bytes, base64-encoded");
  }
  return key;
}

/**
 * بيشفّر حقل طبي أو الرقم المدني بمفتاح العيادة (HKDF من المفتاح الرئيسي)، ومربوط بالجدول والعمود والصف
 * والعيادة، عشان القيمة المنسوخة لمكان تاني ماتتفتحش (ADR-0028). بيقرا كل إصدار متسجّل وبيكتب بالإصدار
 * النشط بس، فتغيير المفتاح = إصدار جديد، مش إعادة تشفير في نفس اللحظة.
 */
export class FieldCipher {
  readonly #keys: ReadonlyMap<number, Buffer>;
  readonly #writeVersion: number;

  constructor(keys: ReadonlyMap<number, Buffer>, writeVersion: number) {
    for (const [version, key] of keys) {
      if (key.length !== KEY_BYTES) {
        throw new KeyConfigError(
          `MEDICAL_MASTER_KEY_V${version}`,
          "must be 32 bytes, base64-encoded",
        );
      }
    }
    if (!keys.has(writeVersion)) {
      throw new KeyConfigError(`MEDICAL_MASTER_KEY_V${writeVersion}`, "is missing");
    }
    this.#keys = new Map(keys);
    this.#writeVersion = writeVersion;
  }

  /** الإصدار اللي كل كتابة جديدة بتتشفّر بيه. */
  get writeVersion(): number {
    return this.#writeVersion;
  }

  #clinicKey(clinicId: string, version: number): Buffer {
    const master = this.#keys.get(version);
    if (master === undefined) throw new Error("unknown key version");
    return deriveClinicKey(master, clinicId, FIELD_INFO);
  }

  /**
   * بيشفّر النص لمكانه بالظبط.
   *
   * @param clinicId العيادة (مفتاحها مشتق منها)
   * @param ref مكان القيمة
   * @param plain النص (`""` مسموح ويرجع زي ما هو)
   * @returns `f1.<version>.<iv>.<ciphertext>.<tag>` بـ base64url
   */
  seal(clinicId: string, ref: FieldRef, plain: string): string {
    return this.sealBytes(clinicId, ref, Buffer.from(plain, "utf8"));
  }

  /**
   * بيفتح ظرف اتشفّر لنفس المكان بالظبط؛ أي تلاعب أو مكان غلط أو شكل غلط بيرمي خطأ من غير ما يكشف حاجة.
   *
   * @param clinicId العيادة
   * @param ref مكان القيمة
   * @param envelope الظرف
   * @returns النص
   */
  open(clinicId: string, ref: FieldRef, envelope: string): string {
    return this.openBytes(clinicId, ref, envelope).toString("utf8");
  }

  /**
   * زي `seal` بالظبط لبايتات (محتوى مرفق): نفس الظرف ونفس الربط بالمكان، والجسم base64url جوه الظرف.
   *
   * @param clinicId العيادة (مفتاحها مشتق منها)
   * @param ref مكان القيمة
   * @param plain البايتات (فاضية مسموح)
   * @returns `f1.<version>.<iv>.<ciphertext>.<tag>` بـ base64url
   */
  sealBytes(clinicId: string, ref: FieldRef, plain: Uint8Array): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#clinicKey(clinicId, this.#writeVersion), iv, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(additionalData(clinicId, ref));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return [
      PREFIX,
      String(this.#writeVersion),
      iv.toString("base64url"),
      body.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
  }

  /**
   * زي `open` بالظبط لظرف بايتات؛ أي تلاعب أو مكان غلط أو شكل غلط بيرمي.
   *
   * @param clinicId العيادة
   * @param ref مكان القيمة
   * @param envelope الظرف
   * @returns البايتات
   */
  openBytes(clinicId: string, ref: FieldRef, envelope: string): Buffer {
    // R1-8: the shape is checked by length, never by truthiness — an empty ciphertext ("") is legal.
    const parts = envelope.split(".");
    if (parts.length !== 5 || parts[0] !== PREFIX) throw new TypeError("malformed envelope");
    const [, version, ivText, bodyText, tagText] = parts as [
      string,
      string,
      string,
      string,
      string,
    ];
    const iv = Buffer.from(ivText, "base64url");
    const tag = Buffer.from(tagText, "base64url");
    if (!/^[1-9][0-9]*$/.test(version) || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new TypeError("malformed envelope");
    }
    const decipher = createDecipheriv(ALGORITHM, this.#clinicKey(clinicId, Number(version)), iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(additionalData(clinicId, ref));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(bodyText, "base64url")), decipher.final()]);
  }
}

/**
 * بيبني الـ cipher من متغيرات البيئة (`MEDICAL_MASTER_KEY_V<n>` و`MEDICAL_KEY_VERSION`، الافتراضي 1)،
 * ويفشل وقت التشغيل لو الإصدار مش رقم صحيح موجب أو مفتاحه ناقص أو أي مفتاح متسجّل شكله غلط.
 *
 * @param env البيئة
 * @returns الـ cipher
 */
export function fieldCipherFromEnv(env: Record<string, string | undefined>): FieldCipher {
  const rawVersion = env["MEDICAL_KEY_VERSION"] || "1";
  if (!/^[1-9][0-9]{0,3}$/.test(rawVersion)) {
    throw new KeyConfigError("MEDICAL_KEY_VERSION", "must be a positive integer");
  }
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const match = /^MEDICAL_MASTER_KEY_V([1-9][0-9]{0,3})$/.exec(name);
    if (match !== null && value !== undefined && value !== "") {
      keys.set(Number(match[1]), strictKey(name, value));
    }
  }
  return new FieldCipher(keys, Number(rawVersion));
}
