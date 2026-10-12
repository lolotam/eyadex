import { ConfigurationError } from "@eyadex/observability";
import { Global, Module } from "@nestjs/common";
import { fieldCipherFromEnv, indexKeyFromEnv, type FieldCipher } from "@eyadex/secrets";

/** Token الـ DI للـ `FieldCipher` (ADR-0028): كل عمود `*_enc` والرقم المدني. */
export const FIELD_CIPHER = Symbol("shared.FieldCipher");
/** Token الـ DI لمفتاح فهرس الرقم المدني (`MEDICAL_INDEX_KEY`، مابيتغيّرش أبدًا، R1-7). */
export const CIVIL_ID_INDEX_KEY = Symbol("shared.CivilIdIndexKey");

// The secrets package names the variable only, never its value; the prefix matches every other startup
// configuration error of the API.
function configured<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new ConfigurationError("API", error.message);
  }
}

/**
 * الـ cipher من `MEDICAL_MASTER_KEY_V<n>` و`MEDICAL_KEY_VERSION`؛ ناقص أو غلط = الـ API مايقومش.
 *
 * @param env البيئة
 * @returns الـ cipher
 */
export const readFieldCipher = (env: NodeJS.ProcessEnv): FieldCipher =>
  configured(() => fieldCipherFromEnv(env));

/**
 * مفتاح الفهرس من `MEDICAL_INDEX_KEY`؛ ناقص أو غلط = الـ API مايقومش.
 *
 * @param env البيئة
 * @returns المفتاح (32 بايت)
 */
export const readCivilIdIndexKey = (env: NodeJS.ProcessEnv): Buffer =>
  configured(() => indexKeyFromEnv(env));

/**
 * مفاتيح الطب مرة واحدة للـ app كله (ADR-0028). موديولات المراجعين والطب بس اللي بتستوردها، فالـ app من
 * غير منطقة العيادة (اختبارات الـ auth) مش محتاجها، والـ deploy (`main.ts` بيركّب العيادة) مايقومش من
 * غيرها. الـ worker عمره ما بيحتاجها.
 */
@Global()
@Module({
  providers: [
    { provide: FIELD_CIPHER, useFactory: () => readFieldCipher(process.env) },
    { provide: CIVIL_ID_INDEX_KEY, useFactory: () => readCivilIdIndexKey(process.env) },
  ],
  exports: [FIELD_CIPHER, CIVIL_ID_INDEX_KEY],
})
export class FieldEncryptionModule {}
